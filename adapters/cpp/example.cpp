#include "telemetry.hpp"
#include <chrono>
#include <thread>
#include <fstream>
#include <iostream>
#include <atomic>
int main(int argc,char** argv){
    if(argc!=2){std::cerr<<"Usage: nexus_example output.ndjson\nSynthetic example only; does not connect to an exchange.\n";return 1;}
    std::ofstream output(argv[1],std::ios::out|std::ios::trunc);if(!output){std::cerr<<"Cannot open output\n";return 1;}
    nexus::Queue queue;std::atomic<bool> done{false};const auto epoch=std::chrono::steady_clock::now();
    const auto elapsed=[&](){return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now()-epoch).count());};
    std::thread producer([&]{for(int tick=0;tick<100;tick++){
        for(std::uint8_t id=0;id<5;id++){nexus::Event e;e.entity=id;e.exchange=nexus::Exchange::CME;e.state=nexus::State::Running;e.timestamp_ns=elapsed();e.pnl_micro=(tick*100+id*500)*1000000LL;e.position=tick%6;e.orders=tick;e.fills=tick;e.latency_ns=200+id*20;queue.try_push(e);}
        for(std::uint8_t id=0;id<2;id++){nexus::Event e;e.kind=nexus::Kind::FeedSnapshot;e.entity=id;e.state=nexus::State::Running;e.feed_sequence=10000+tick*100;queue.try_push(e);}
        nexus::Event e;e.kind=nexus::Kind::Fill;e.entity=tick%5;e.order_id=tick+1;e.timestamp_ns=elapsed();e.price_micro=5000000000LL;e.quantity=1;queue.try_push(e);
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }done.store(true,std::memory_order_release);});
    nexus::Aggregator aggregator;
    while(!done.load(std::memory_order_acquire)){aggregator.drain(queue);aggregator.write_frame(output,elapsed(),queue.dropped(),true);std::this_thread::sleep_for(std::chrono::milliseconds(100));}
    producer.join();aggregator.drain(queue);aggregator.write_frame(output,elapsed(),queue.dropped(),true);
    if(!output){std::cerr<<"Cold telemetry writer failed\n";return 1;}
}
