package escpos

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func mustBytes(t *testing.T, got, want []byte) {
	t.Helper()
	if !bytes.Equal(got, want) {
		t.Errorf("byte mismatch\n  got  %v\n  want %v", got, want)
	}
}

// ---------------------------------------------------------------------------
// TestNew — fresh builder has empty buffer
// ---------------------------------------------------------------------------

func TestNew(t *testing.T) {
	b := New()
	if got := b.Bytes(); len(got) != 0 {
		t.Errorf("New() buffer should be empty, got %d bytes", len(got))
	}
}

// ---------------------------------------------------------------------------
// TestInit
// ---------------------------------------------------------------------------

func TestInit(t *testing.T) {
	got := New().Init().Bytes()
	want := []byte{0x1B, 0x40}
	mustBytes(t, got, want)
}

// ---------------------------------------------------------------------------
// TestBold
// ---------------------------------------------------------------------------

func TestBold(t *testing.T) {
	tests := []struct {
		name string
		on   bool
		want []byte
	}{
		{"bold on", true, []byte{0x1B, 0x45, 0x01}},
		{"bold off", false, []byte{0x1B, 0x45, 0x00}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := New().Bold(tc.on).Bytes()
			mustBytes(t, got, tc.want)
		})
	}
}

// ---------------------------------------------------------------------------
// TestAlign
// ---------------------------------------------------------------------------

func TestAlign(t *testing.T) {
	tests := []struct {
		name  string
		align int
		want  []byte
	}{
		{"left", AlignLeft, []byte{0x1B, 0x61, 0x00}},
		{"center", AlignCenter, []byte{0x1B, 0x61, 0x01}},
		{"right", AlignRight, []byte{0x1B, 0x61, 0x02}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := New().Align(tc.align).Bytes()
			mustBytes(t, got, tc.want)
		})
	}
}

// ---------------------------------------------------------------------------
// TestCut / TestPartialCut
// ---------------------------------------------------------------------------

func TestCut(t *testing.T) {
	got := New().Cut().Bytes()
	want := []byte{0x1D, 0x56, 0x00}
	mustBytes(t, got, want)
}

func TestPartialCut(t *testing.T) {
	got := New().PartialCut().Bytes()
	want := []byte{0x1D, 0x56, 0x01}
	mustBytes(t, got, want)
}

// ---------------------------------------------------------------------------
// TestDrawerKick
// ---------------------------------------------------------------------------

func TestDrawerKick(t *testing.T) {
	got := New().DrawerKick().Bytes()
	want := []byte{0x1B, 0x70, 0x00, 0x19, 0xFA}
	mustBytes(t, got, want)
}

// ---------------------------------------------------------------------------
// TestLineFeed
// ---------------------------------------------------------------------------

func TestLineFeed(t *testing.T) {
	got := New().LineFeed().Bytes()
	want := []byte{0x0A}
	mustBytes(t, got, want)
}

// ---------------------------------------------------------------------------
// TestText
// ---------------------------------------------------------------------------

func TestText(t *testing.T) {
	got := New().Text("hello").Bytes()
	want := []byte("hello")
	mustBytes(t, got, want)
}

func TestTextNewline(t *testing.T) {
	got := New().Text("a\nb").Bytes()
	want := []byte("a\nb")
	mustBytes(t, got, want)
}

// ---------------------------------------------------------------------------
// TestDivider
// ---------------------------------------------------------------------------

func TestDivider(t *testing.T) {
	got := New().Divider().Bytes()
	// 42 dashes + newline
	wantStr := "------------------------------------------\n"
	if string(got) != wantStr {
		t.Errorf("Divider: got %q, want %q", string(got), wantStr)
	}
	if len(got) != 43 {
		t.Errorf("Divider: expected 43 bytes (42 dashes + LF), got %d", len(got))
	}
}

// ---------------------------------------------------------------------------
// TestHRIPosition
// ---------------------------------------------------------------------------

func TestHRIPosition(t *testing.T) {
	tests := []struct {
		name string
		n    int
		want []byte
	}{
		{"none", 0, []byte{0x1D, 0x48, 0x00}},
		{"above", 1, []byte{0x1D, 0x48, 0x01}},
		{"below", 2, []byte{0x1D, 0x48, 0x02}},
		{"both", 3, []byte{0x1D, 0x48, 0x03}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := New().HRIPosition(tc.n).Bytes()
			mustBytes(t, got, tc.want)
		})
	}
}

// ---------------------------------------------------------------------------
// TestBarcode — NEW form: GS k m n data (no NUL)
// ---------------------------------------------------------------------------

func TestBarcodeNewForm(t *testing.T) {
	tests := []struct {
		name        string
		barcodeType int
		data        string
		wantPrefix  []byte // the 4-byte header: 0x1D 0x6B type len
		wantData    string
	}{
		{
			name:        "Code128",
			barcodeType: BarcodeCode128,
			data:        "ABC123",
			wantPrefix:  []byte{0x1D, 0x6B, 0x49, 0x06},
			wantData:    "ABC123",
		},
		{
			name:        "EAN13",
			barcodeType: BarcodeEAN13,
			data:        "4006381333931",
			wantPrefix:  []byte{0x1D, 0x6B, 0x43, 0x0D},
			wantData:    "4006381333931",
		},
		{
			name:        "UPCA",
			barcodeType: BarcodeUPCA,
			data:        "01234567890",
			wantPrefix:  []byte{0x1D, 0x6B, 0x41, 0x0B},
			wantData:    "01234567890",
		},
		{
			name:        "Code39",
			barcodeType: BarcodeCode39,
			data:        "HELLO",
			wantPrefix:  []byte{0x1D, 0x6B, 0x45, 0x05},
			wantData:    "HELLO",
		},
		{
			name:        "ITF",
			barcodeType: BarcodeITF,
			data:        "12345678",
			wantPrefix:  []byte{0x1D, 0x6B, 0x46, 0x08},
			wantData:    "12345678",
		},
		{
			name:        "Code93",
			barcodeType: BarcodeCode93,
			data:        "XYZ",
			wantPrefix:  []byte{0x1D, 0x6B, 0x48, 0x03},
			wantData:    "XYZ",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := New().Barcode(tc.barcodeType, tc.data).Bytes()

			// Verify total length: 4-byte header + data bytes
			wantLen := 4 + len(tc.data)
			if len(got) != wantLen {
				t.Fatalf("Barcode length: got %d, want %d", len(got), wantLen)
			}

			// Verify header
			mustBytes(t, got[:4], tc.wantPrefix)

			// Verify data (no NUL terminator)
			if string(got[4:]) != tc.wantData {
				t.Errorf("Barcode data: got %q, want %q", string(got[4:]), tc.wantData)
			}

			// Confirm no NUL terminator in the output
			if bytes.ContainsRune(got, 0x00) {
				t.Errorf("Barcode output must NOT contain a NUL terminator")
			}
		})
	}
}

// TestBarcodeLengthGuard — data outside [1,255] must be silently ignored.
func TestBarcodeLengthGuard(t *testing.T) {
	tests := []struct {
		name string
		data string
	}{
		{"empty string", ""},
		{"256 bytes", strings.Repeat("A", 256)},
		{"300 bytes", strings.Repeat("Z", 300)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := New().Barcode(BarcodeCode128, tc.data).Bytes()
			if len(got) != 0 {
				t.Errorf("Barcode(%q): expected no output for invalid length, got %d bytes", tc.name, len(got))
			}
		})
	}
}

// TestBarcodeMaxValid — exactly 255 bytes must be accepted.
func TestBarcodeMaxValid(t *testing.T) {
	data := strings.Repeat("X", 255)
	got := New().Barcode(BarcodeCode128, data).Bytes()
	wantLen := 4 + 255
	if len(got) != wantLen {
		t.Errorf("Barcode(255 bytes): expected %d bytes, got %d", wantLen, len(got))
	}
	// length byte in header must be 0xFF
	if got[3] != 0xFF {
		t.Errorf("Barcode(255 bytes): length byte = 0x%02X, want 0xFF", got[3])
	}
}

// ---------------------------------------------------------------------------
// TestChainedCalls — accumulation order
// ---------------------------------------------------------------------------

func TestChainedCalls(t *testing.T) {
	got := New().
		Init().
		Align(AlignCenter).
		Bold(true).
		Text("HELLO").
		Bold(false).
		Align(AlignLeft).
		LineFeed().
		Cut().
		Bytes()

	var want []byte
	want = append(want, 0x1B, 0x40)             // Init
	want = append(want, 0x1B, 0x61, 0x01)        // Align center
	want = append(want, 0x1B, 0x45, 0x01)        // Bold on
	want = append(want, []byte("HELLO")...)       // Text
	want = append(want, 0x1B, 0x45, 0x00)        // Bold off
	want = append(want, 0x1B, 0x61, 0x00)        // Align left
	want = append(want, 0x0A)                    // LineFeed
	want = append(want, 0x1D, 0x56, 0x00)        // Cut

	mustBytes(t, got, want)
}

// TestChainedWithBarcode — Init + HRIPosition + Barcode + Cut
func TestChainedWithBarcode(t *testing.T) {
	data := "123456"
	got := New().
		Init().
		HRIPosition(2).
		Barcode(BarcodeCode128, data).
		Cut().
		Bytes()

	var want []byte
	want = append(want, 0x1B, 0x40)                                  // Init
	want = append(want, 0x1D, 0x48, 0x02)                            // HRIPosition below
	want = append(want, 0x1D, 0x6B, byte(BarcodeCode128), 0x06)      // Barcode header
	want = append(want, []byte(data)...)                              // Barcode data
	want = append(want, 0x1D, 0x56, 0x00)                            // Cut

	mustBytes(t, got, want)
}

// ---------------------------------------------------------------------------
// TestBytesDoesNotReset — calling Bytes() twice returns same data
// ---------------------------------------------------------------------------

func TestBytesDoesNotReset(t *testing.T) {
	b := New().Init().Text("X")
	first := b.Bytes()
	second := b.Bytes()
	if !bytes.Equal(first, second) {
		t.Error("Bytes() must be idempotent and not reset the builder")
	}
}

// ---------------------------------------------------------------------------
// TestStubPrinter
// ---------------------------------------------------------------------------

func TestStubPrinterCaptures(t *testing.T) {
	stub := &StubPrinter{}
	ctx := context.Background()

	data := New().Init().Text("test").Cut().Bytes()
	if err := stub.Print(ctx, data); err != nil {
		t.Fatalf("StubPrinter.Print returned unexpected error: %v", err)
	}

	if len(stub.Calls) != 1 {
		t.Fatalf("expected 1 call, got %d", len(stub.Calls))
	}
	mustBytes(t, stub.LastCall(), data)
}

func TestStubPrinterAccumulatesCalls(t *testing.T) {
	stub := &StubPrinter{}
	ctx := context.Background()

	first := New().Init().Bytes()
	second := New().Cut().Bytes()

	_ = stub.Print(ctx, first)
	_ = stub.Print(ctx, second)

	if len(stub.Calls) != 2 {
		t.Fatalf("expected 2 calls, got %d", len(stub.Calls))
	}
	mustBytes(t, stub.Calls[0], first)
	mustBytes(t, stub.Calls[1], second)
}

func TestStubPrinterError(t *testing.T) {
	sentinel := errors.New("printer offline")
	stub := &StubPrinter{Err: sentinel}

	err := stub.Print(context.Background(), []byte{0x01})
	if !errors.Is(err, sentinel) {
		t.Errorf("expected sentinel error, got %v", err)
	}
	if len(stub.Calls) != 0 {
		t.Error("Calls should not be recorded when Err is set")
	}
}

func TestStubPrinterLastCallNilWhenEmpty(t *testing.T) {
	stub := &StubPrinter{}
	if stub.LastCall() != nil {
		t.Error("LastCall() should return nil before any Print calls")
	}
}

// TestStubPrinterIsolatesCopy — mutating returned slice must not affect stored call.
func TestStubPrinterIsolatesCopy(t *testing.T) {
	stub := &StubPrinter{}
	data := []byte{0x01, 0x02, 0x03}
	_ = stub.Print(context.Background(), data)

	// Mutate the original slice after print
	data[0] = 0xFF
	if stub.Calls[0][0] == 0xFF {
		t.Error("StubPrinter must store a copy, not a reference")
	}
}

// ---------------------------------------------------------------------------
// TestAlignConstants — verify numeric values match the ESC/POS spec
// ---------------------------------------------------------------------------

func TestAlignConstants(t *testing.T) {
	if AlignLeft != 0 {
		t.Errorf("AlignLeft must be 0, got %d", AlignLeft)
	}
	if AlignCenter != 1 {
		t.Errorf("AlignCenter must be 1, got %d", AlignCenter)
	}
	if AlignRight != 2 {
		t.Errorf("AlignRight must be 2, got %d", AlignRight)
	}
}

// TestBarcodeTypeConstants — verify the NEW-form values.
func TestBarcodeTypeConstants(t *testing.T) {
	tests := []struct {
		name  string
		got   int
		want  int
	}{
		{"BarcodeUPCA", BarcodeUPCA, 65},
		{"BarcodeEAN13", BarcodeEAN13, 67},
		{"BarcodeCode39", BarcodeCode39, 69},
		{"BarcodeITF", BarcodeITF, 70},
		{"BarcodeCode93", BarcodeCode93, 72},
		{"BarcodeCode128", BarcodeCode128, 73},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if tc.got != tc.want {
				t.Errorf("%s = %d, want %d", tc.name, tc.got, tc.want)
			}
		})
	}
}
