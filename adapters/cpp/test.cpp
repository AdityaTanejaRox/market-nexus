#include "telemetry.hpp"
#include <cassert>
#include <thread>
int main(){
    nexus::SpscQueue<nexus::Event,4> small;nexus::Event e;e.order_id=1;
    assert(small.try_push(e));assert(small.try_push(e));assert(small.try_push(e));assert(!small.try_push(e));assert(small.dropped()==1);
    for(int i=0;i<3;i++){assert(small.try_pop(e));}
    assert(!small.try_pop(e));
    nexus::Queue queue;
    std::thread producer([&]{for(std::uint64_t i=1;i<=100000;i++){nexus::Event next;next.order_id=i;while(!queue.try_push(next))std::this_thread::yield();}});
    for(std::uint64_t i=1;i<=100000;i++){while(!queue.try_pop(e))std::this_thread::yield();assert(e.order_id==i);}producer.join();
}
