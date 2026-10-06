#pragma once
#include <array>
#include <atomic>
#include <cstdint>
#include <type_traits>
#include <vector>
#include <ostream>
#include <iomanip>
#include <locale>

namespace nexus {
// Exactly one producer and one consumer per queue. No allocation or waiting in try_push.
template<class T, std::size_t Capacity>
class SpscQueue {
    static_assert(std::atomic<std::size_t>::is_always_lock_free && std::atomic<std::uint64_t>::is_always_lock_free, "Lock-free atomics required on this target");
    static_assert(Capacity >= 2 && (Capacity & (Capacity - 1)) == 0, "Power-of-two capacity required");
    static_assert(std::is_trivially_copyable<T>::value, "Fixed-size value type required");
    alignas(64) std::atomic<std::size_t> write_{0};
    alignas(64) std::atomic<std::size_t> read_{0};
    alignas(64) std::array<T, Capacity> values_{};
    alignas(64) std::atomic<std::uint64_t> drops_{0};
public:
    bool try_push(const T& value) noexcept {
        const auto write = write_.load(std::memory_order_relaxed);
        const auto next = (write + 1) & (Capacity - 1);
        if (next == read_.load(std::memory_order_acquire)) {
            drops_.fetch_add(1, std::memory_order_relaxed); return false;
        }
        values_[write] = value;
        write_.store(next, std::memory_order_release); return true;
    }
    bool try_pop(T& value) noexcept {
        const auto read = read_.load(std::memory_order_relaxed);
        if (read == write_.load(std::memory_order_acquire)) return false;
        value = values_[read];
        read_.store((read + 1) & (Capacity - 1), std::memory_order_release); return true;
    }
    std::uint64_t dropped() const noexcept { return drops_.load(std::memory_order_relaxed); }
};
enum class Kind : std::uint8_t { StrategySnapshot, FeedSnapshot, OrderCreated, RiskPassed, RiskRejected, OrderSent, OrderAck, Fill, FeedGap, FeedRecovered };
enum class State : std::uint8_t { Running, Idle, Degraded, Stopped };
// IDs 0..4 identify mm/arb/mom/vwap/rev. Feed IDs are 0=A and 1=B.
// Prices and P&L are signed millionths of display currency units.
struct Event {
    Kind kind{Kind::StrategySnapshot};
    std::uint8_t entity{0};
    State state{State::Idle};
    bool buy{true};
    std::uint64_t timestamp_ns{0}, order_id{0};
    std::int64_t price_micro{0}, pnl_micro{0}, position{0}, quantity{1};
    std::uint64_t orders{0}, fills{0}, latency_ns{0}, feed_sequence{0}, gaps{0};
};
using Queue = SpscQueue<Event, 4096>;
// Cold-thread-only aggregator. Snapshot events overwrite authoritative cumulative state;
// order events animate lifecycle stages and do not mutate accounting counters.
class Aggregator {
    std::array<Event,5> strategies_{};
    std::array<Event,2> feeds_{};
    std::vector<Event> events_;
    std::uint64_t sequence_{0}, event_id_{0}, omitted_{0};
    inline static constexpr const char* ids_[5] = {"mm","arb","mom","vwap","rev"};
    inline static constexpr const char* names_[5] = {"Market maker","Stat arbitrage","Momentum","VWAP execution","Mean reversion"};
    inline static constexpr const char* symbols_[5] = {"ES","NQ","CL","ZN","GC"};
    static const char* state(State state) {
        switch(state){case State::Running:return "RUNNING";case State::Degraded:return "DEGRADED";case State::Stopped:return "STOPPED";default:return "IDLE";}
    }
    static const char* type(Kind kind) {
        switch(kind){case Kind::OrderCreated:return "ORDER_CREATED";case Kind::RiskPassed:return "RISK_PASSED";case Kind::RiskRejected:return "RISK_REJECTED";case Kind::OrderSent:return "ORDER_SENT";case Kind::OrderAck:return "ORDER_ACK";case Kind::Fill:return "FILL";case Kind::FeedGap:return "FEED_GAP";default:return "FEED_RECOVERED";}
    }
public:
    Aggregator(){events_.reserve(200);for(auto& feed:feeds_)feed.state=State::Stopped;}
    void drain(Queue& queue, std::size_t budget=8192) {
        Event event;
        while(budget-- && queue.try_pop(event)){
            if(event.kind==Kind::StrategySnapshot){if(event.entity<5)strategies_[event.entity]=event;}
            else if(event.kind==Kind::FeedSnapshot){if(event.entity<2)feeds_[event.entity]=event;}
            else if((event.kind==Kind::FeedGap||event.kind==Kind::FeedRecovered)?event.entity<2:event.entity<5){
                if(events_.size()<200)events_.push_back(event);else omitted_++;
            }
        }
    }
    void write_frame(std::ostream& out, std::uint64_t elapsed_ns, std::uint64_t producer_drops, bool example=false) {
        out.imbue(std::locale::classic());out<<std::setprecision(15);
        out<<"{\"version\":1,\"source\":\""<<(example?"example":"telemetry")<<"\",\"seq\":"<<++sequence_<<",\"time\":"<<elapsed_ns/1e9<<",\"dropped\":"<<producer_drops+omitted_<<",\"strategies\":[";
        for(std::size_t i=0;i<5;i++){
            const auto& s=strategies_[i];if(i)out<<',';
            out<<"{\"id\":\""<<ids_[i]<<"\",\"name\":\""<<names_[i]<<"\",\"symbol\":\""<<symbols_[i]<<"\",\"state\":\""<<state(s.state)<<"\",\"pnl\":"<<s.pnl_micro/1e6<<",\"position\":"<<s.position<<",\"orders\":"<<s.orders<<",\"fills\":"<<s.fills<<",\"latency\":"<<s.latency_ns<<'}';
        }
        out<<"],\"feeds\":[";
        for(std::size_t i=0;i<2;i++){const auto& f=feeds_[i];if(i)out<<',';out<<"{\"id\":\""<<(i?"B":"A")<<"\",\"seq\":"<<f.feed_sequence<<",\"gaps\":"<<f.gaps<<",\"state\":\""<<(f.state==State::Running?"HEALTHY":f.state==State::Degraded?"DEGRADED":"OFFLINE")<<"\"}";}
        out<<"],\"events\":[";
        for(std::size_t i=0;i<events_.size();i++){
            const auto& e=events_[i];if(i)out<<',';
            out<<"{\"id\":\"evt-"<<++event_id_<<"\",\"type\":\""<<type(e.kind)<<"\",\"time\":"<<e.timestamp_ns/1e9;
            if(e.kind==Kind::FeedGap||e.kind==Kind::FeedRecovered)out<<",\"feed\":\""<<(e.entity?"B":"A")<<'"';
            else out<<",\"orderId\":\""<<e.order_id<<"\",\"strategyId\":\""<<ids_[e.entity]<<"\",\"side\":\""<<(e.buy?"BUY":"SELL")<<"\",\"qty\":"<<e.quantity<<",\"price\":"<<e.price_micro/1e6;
            out<<'}';
        }
        out<<"]}\n";out.flush();events_.clear();
    }
};
} // namespace nexus
