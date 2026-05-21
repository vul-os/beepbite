// Package escpos provides a pure-Go ESC/POS command builder and a network
// printer client. It produces []byte command sequences; it does NOT perform
// any hardware I/O itself — the caller (NetworkPrinter or a test stub) decides
// what to do with the bytes.
//
// Quick-start:
//
//	b := escpos.New().
//	    Init().
//	    Align(escpos.AlignCenter).
//	    Bold(true).
//	    Text("BEEPBITE\n").
//	    Bold(false).
//	    Align(escpos.AlignLeft).
//	    Text("Item 1   R12.00\n").
//	    Cut().
//	    Bytes()
//
//	// print via network
//	p := escpos.NewNetworkPrinter("192.168.1.100", 9100)
//	if err := p.Print(ctx, b); err != nil { ... }
package escpos

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"time"
)

// ---------------------------------------------------------------------------
// Constants — raw ESC/POS byte sequences
// ---------------------------------------------------------------------------

// Alignment constants for Align().
const (
	AlignLeft   = 0
	AlignCenter = 1
	AlignRight  = 2
)

// Barcode type constants for Barcode().
const (
	BarcodeUPCA    = 65
	BarcodeEAN13   = 67
	BarcodeCode39  = 69
	BarcodeITF     = 70
	BarcodeCode93  = 72
	BarcodeCode128 = 73
)

var (
	cmdInit       = []byte{0x1B, 0x40}                   // ESC @ — initialize printer
	cmdCutFull    = []byte{0x1D, 0x56, 0x00}             // GS V m — full cut
	cmdCutPartial = []byte{0x1D, 0x56, 0x01}             // GS V m — partial cut
	cmdDrawerKick = []byte{0x1B, 0x70, 0x00, 0x19, 0xFA} // ESC p — cash drawer kick
	cmdBoldOn     = []byte{0x1B, 0x45, 0x01}             // ESC E 1 — bold on
	cmdBoldOff    = []byte{0x1B, 0x45, 0x00}             // ESC E 0 — bold off
	cmdLineFeed   = []byte{0x0A}                         // LF
)

func cmdAlign(n int) []byte { return []byte{0x1B, 0x61, byte(n)} } // ESC a n

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

// Builder accumulates ESC/POS command bytes. Methods return *Builder for
// chaining. Call Bytes() to get the final command sequence.
type Builder struct {
	buf bytes.Buffer
}

// New returns a fresh Builder.
func New() *Builder { return &Builder{} }

// Bytes returns the accumulated command bytes. Does not reset the builder.
func (b *Builder) Bytes() []byte { return b.buf.Bytes() }

// Init emits the ESC @ initialize-printer command. Should be the first command
// in any sequence to reset font, alignment, and mode to defaults.
func (b *Builder) Init() *Builder {
	b.buf.Write(cmdInit)
	return b
}

// Text writes raw text bytes. Use "\n" to advance lines; the printer renders
// text in whatever font and alignment are currently set.
func (b *Builder) Text(s string) *Builder {
	b.buf.WriteString(s)
	return b
}

// LineFeed advances the paper by one line.
func (b *Builder) LineFeed() *Builder {
	b.buf.Write(cmdLineFeed)
	return b
}

// Bold toggles bold mode on or off.
func (b *Builder) Bold(on bool) *Builder {
	if on {
		b.buf.Write(cmdBoldOn)
	} else {
		b.buf.Write(cmdBoldOff)
	}
	return b
}

// Align sets horizontal text alignment. Use the AlignLeft/AlignCenter/AlignRight
// constants.
func (b *Builder) Align(n int) *Builder {
	b.buf.Write(cmdAlign(n))
	return b
}

// Cut emits a full paper cut command (GS V 0).
func (b *Builder) Cut() *Builder {
	b.buf.Write(cmdCutFull)
	return b
}

// PartialCut emits a partial paper cut command (GS V 1).
func (b *Builder) PartialCut() *Builder {
	b.buf.Write(cmdCutPartial)
	return b
}

// DrawerKick emits the cash-drawer kick pulse (ESC p). The specific pulse
// timings (0x19, 0xFA) are compatible with most Epson and Star cash drawers.
func (b *Builder) DrawerKick() *Builder {
	b.buf.Write(cmdDrawerKick)
	return b
}

// Barcode emits a GS k barcode print command (NEW form: GS k m n data).
// barcodeType should be one of the Barcode* (NEW-form) constants.
// data is the barcode content string (ASCII); max 255 bytes.
// The printer must support the requested barcode type; otherwise it silently
// skips the command. HRI (human-readable interpretation) digits are printed
// below by default (GS H 2 — set before calling Barcode if you want a
// different position).
func (b *Builder) Barcode(barcodeType int, data string) *Builder {
	if len(data) == 0 || len(data) > 255 {
		return b
	}
	// Epson ESC/POS GS k has two forms:
	//   OLD:  GS k m d1…dn NUL      where m is 0–6
	//   NEW:  GS k m n  d1…dn       where m is 65–73, n = byte length of data
	// Our Barcode* constants (UPCA=65, EAN13=67, …) are NEW-form values, so we
	// emit the NEW form: a one-byte length follows m, and there is NO NUL
	// terminator. (Mixing NEW-form m with the OLD-form NUL framing — the prior
	// behaviour — produced an invalid command on most printers.)
	b.buf.Write([]byte{0x1D, 0x6B, byte(barcodeType), byte(len(data))})
	b.buf.WriteString(data)
	return b
}

// HRIPosition sets the HRI (human-readable interpretation) position for
// barcodes. n: 0=none, 1=above, 2=below, 3=both.
func (b *Builder) HRIPosition(n int) *Builder {
	b.buf.Write([]byte{0x1D, 0x48, byte(n)})
	return b
}

// Divider writes a line of dashes across the full 42-column paper width.
func (b *Builder) Divider() *Builder {
	b.buf.WriteString("------------------------------------------\n")
	return b
}

// ---------------------------------------------------------------------------
// Printer interface
// ---------------------------------------------------------------------------

// Printer abstracts a physical or stubbed printer so handlers are testable
// without a live device.
type Printer interface {
	// Print sends the ESC/POS command bytes to the printer.
	Print(ctx context.Context, data []byte) error
}

// ---------------------------------------------------------------------------
// NetworkPrinter — TCP ESC/POS client
// ---------------------------------------------------------------------------

// NetworkPrinter dials host:port and writes ESC/POS bytes over TCP.
// It implements Printer. Each Print call opens a fresh connection so that
// idle-connection issues with cheap printers are avoided.
type NetworkPrinter struct {
	Host        string
	Port        int
	DialTimeout time.Duration
}

// NewNetworkPrinter constructs a NetworkPrinter with a default 5-second
// dial timeout.
func NewNetworkPrinter(host string, port int) *NetworkPrinter {
	return &NetworkPrinter{
		Host:        host,
		Port:        port,
		DialTimeout: 5 * time.Second,
	}
}

// Print dials the printer, writes data, and closes the connection.
// The context deadline/cancel is respected for the dial phase; the write
// uses the remaining context deadline if set.
func (p *NetworkPrinter) Print(ctx context.Context, data []byte) error {
	addr := fmt.Sprintf("%s:%d", p.Host, p.Port)

	dialer := &net.Dialer{Timeout: p.DialTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("escpos: dial %s: %w", addr, err)
	}
	defer conn.Close()

	// Apply context deadline to the write if one is set.
	if dl, ok := ctx.Deadline(); ok {
		if err := conn.SetWriteDeadline(dl); err != nil {
			return fmt.Errorf("escpos: set write deadline: %w", err)
		}
	}

	if _, err := conn.Write(data); err != nil {
		return fmt.Errorf("escpos: write to %s: %w", addr, err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// StubPrinter — in-memory printer for testing
// ---------------------------------------------------------------------------

// StubPrinter captures Print calls and stores the bytes for assertion.
// It is safe for use in unit tests without a live network connection.
type StubPrinter struct {
	Calls [][]byte
	Err   error // if non-nil, Print returns this error
}

// Print records data and returns Err (nil by default).
func (s *StubPrinter) Print(_ context.Context, data []byte) error {
	if s.Err != nil {
		return s.Err
	}
	cp := make([]byte, len(data))
	copy(cp, data)
	s.Calls = append(s.Calls, cp)
	return nil
}

// LastCall returns the most recently received data, or nil if none.
func (s *StubPrinter) LastCall() []byte {
	if len(s.Calls) == 0 {
		return nil
	}
	return s.Calls[len(s.Calls)-1]
}
