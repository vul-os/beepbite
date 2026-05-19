package kds

import (
	"fmt"
	"sync"
)

// TicketEvent is the payload pushed to SSE subscribers.
type TicketEvent struct {
	TicketID  string `json:"ticket_id"`
	StationID string `json:"station_id"`
	EventType string `json:"event_type"`
	CreatedAt string `json:"created_at"`
}

// broker is a simple in-memory pub/sub keyed by station_id.
// Each subscriber gets its own unbuffered channel; the broker drops events
// that would block (station display offline) rather than stalling writers.
type broker struct {
	mu   sync.Mutex
	subs map[string]map[chan TicketEvent]struct{} // stationID → set of channels
}

func newBroker() *broker {
	return &broker{subs: make(map[string]map[chan TicketEvent]struct{})}
}

// subscribe registers a new channel for the given station and returns it.
// The caller must call unsubscribe when the connection closes.
func (b *broker) subscribe(stationID string) chan TicketEvent {
	ch := make(chan TicketEvent, 16)
	b.mu.Lock()
	if b.subs[stationID] == nil {
		b.subs[stationID] = make(map[chan TicketEvent]struct{})
	}
	b.subs[stationID][ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

// unsubscribe removes and closes the channel for a station.
func (b *broker) unsubscribe(stationID string, ch chan TicketEvent) {
	b.mu.Lock()
	if s, ok := b.subs[stationID]; ok {
		delete(s, ch)
		if len(s) == 0 {
			delete(b.subs, stationID)
		}
	}
	b.mu.Unlock()
	close(ch)
}

// publish sends the event to every subscriber of the station, non-blocking.
func (b *broker) publish(stationID string, ev TicketEvent) {
	b.mu.Lock()
	subs := b.subs[stationID]
	// Copy the set so we can unlock before sending.
	chans := make([]chan TicketEvent, 0, len(subs))
	for ch := range subs {
		chans = append(chans, ch)
	}
	b.mu.Unlock()

	for _, ch := range chans {
		select {
		case ch <- ev:
		default:
			// Subscriber is slow / gone; drop rather than block.
			_ = fmt.Sprintf("kds broker: dropped event for station %s", stationID)
		}
	}
}
