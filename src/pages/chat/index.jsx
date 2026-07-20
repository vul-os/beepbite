import { useState, useRef, useEffect, useCallback } from 'react';
import { useMoney } from '@/context/locale-context';
import { sendChatMessage } from '../../services/customerchat.js';

// ── Simple ID generator ────────────────────────────────────────────────────────
function newId() {
  return Math.random().toString(36).slice(2);
}

// The customer-chat API returns prices as major-unit decimals ("12.50"), not
// minor units, so each is parsed against the active currency before display —
// a fixed two decimals reads ¥1000 as "1000.00" and drops a dinar's third.
function moneyRenderer({ format, parse }) {
  return (value) => {
    const minor = parse(value);
    return minor == null ? '' : format(minor);
  };
}

// ── Tool result renderers ──────────────────────────────────────────────────────

function StoreCard({ store }) {
  return (
    <div className="store-card border rounded p-3 mb-2 bg-white shadow-sm">
      <div className="font-semibold text-gray-800">{store.name}</div>
      {store.address && <div className="text-sm text-gray-500">{store.address}</div>}
      {(store.city || store.country) && (
        <div className="text-xs text-gray-400">{[store.city, store.country].filter(Boolean).join(', ')}</div>
      )}
      {store.slug && (
        <div className="text-xs text-indigo-500 mt-1">slug: {store.slug}</div>
      )}
    </div>
  );
}

function StoresResult({ data }) {
  if (!data?.stores?.length) return <p className="text-sm text-gray-400">No stores found.</p>;
  return (
    <div className="tool-stores mt-1">
      {data.stores.map((s) => <StoreCard key={s.id} store={s} />)}
    </div>
  );
}

function MenuResult({ data }) {
  const money = moneyRenderer(useMoney());
  if (!data?.categories?.length) return <p className="text-sm text-gray-400">No menu items found.</p>;
  return (
    <div className="tool-menu mt-1 space-y-2">
      {data.categories.map((cat) => (
        <div key={cat.id} className="border rounded p-2 bg-white">
          <div className="font-semibold text-gray-700 mb-1">{cat.name}</div>
          {cat.items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm py-0.5">
              <span>{item.name}</span>
              <span className="text-gray-500">{money(item.price)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CartResult({ data }) {
  const money = moneyRenderer(useMoney());
  if (!data?.lines?.length) return <p className="text-sm text-gray-400">Cart is empty.</p>;
  return (
    <div className="tool-cart mt-1 border rounded p-2 bg-white">
      {data.lines.map((line) => (
        <div key={line.cart_item_id} className="flex justify-between text-sm py-0.5">
          <span>{line.quantity}× {line.item_name}{line.modifiers?.length ? ` (${line.modifiers.join(', ')})` : ''}</span>
          <span className="text-gray-500">{money(line.total_price)}</span>
        </div>
      ))}
      <div className="border-t mt-1 pt-1 flex justify-between font-semibold text-sm">
        <span>Subtotal</span>
        <span>{money(data.subtotal)}</span>
      </div>
    </div>
  );
}

function OrderConfirmationResult({ data }) {
  const money = moneyRenderer(useMoney());
  return (
    <div className="tool-confirm mt-1 border rounded p-3 bg-green-50">
      <div className="font-semibold text-green-700">Order Confirmed!</div>
      <div className="text-sm text-gray-600 mt-1">Order #{data.order_number}</div>
      <div className="text-sm text-gray-600">Total: {money(data.total_amount)}</div>
    </div>
  );
}

function TrackResult({ data }) {
  return (
    <div className="tool-track mt-1 border rounded p-2 bg-blue-50 text-sm">
      <span className="font-medium text-blue-700">Order #{data.order_number}</span>
      <span className="ml-2 text-gray-600 capitalize">{data.status?.replace(/_/g, ' ')}</span>
    </div>
  );
}

function ItemDetailResult({ data }) {
  const money = moneyRenderer(useMoney());
  return (
    <div className="tool-item mt-1 border rounded p-2 bg-white text-sm">
      <div className="font-semibold">{data.name}</div>
      {data.description && <div className="text-gray-500 text-xs mt-0.5">{data.description}</div>}
      <div className="mt-1">Price: {money(data.price)}</div>
      {data.variations?.length > 0 && (
        <div className="mt-1">
          {data.variations.map((v) => (
            <div key={v.id} className="mt-1">
              <span className="font-medium">{v.name}{v.is_required ? ' *' : ''}: </span>
              {v.options.map((o) => o.name).join(', ')}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddToCartResult({ data }) {
  if (data?.error) return <p className="text-sm text-red-500">{data.error}</p>;
  return <p className="text-sm text-green-600">{data?.message || 'Added to cart'}</p>;
}

function ToolResultCard({ tool, data }) {
  switch (tool) {
    case 'search_stores':
      return <StoresResult data={data} />;
    case 'get_store_menu':
      return <MenuResult data={data} />;
    case 'get_item_details':
      return <ItemDetailResult data={data} />;
    case 'add_to_cart':
      return <AddToCartResult data={data} />;
    case 'view_cart':
      return <CartResult data={data} />;
    case 'confirm_order':
      return <OrderConfirmationResult data={data} />;
    case 'track_order':
      return <TrackResult data={data} />;
    default:
      return (
        <pre className="text-xs bg-gray-100 rounded p-2 overflow-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? 'bg-indigo-600 text-white rounded-br-sm'
            : 'bg-gray-100 text-gray-800 rounded-bl-sm'
        }`}
      >
        {message.content}
        {!isUser && message.toolResults?.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolResults.map((tr, i) => (
              <ToolResultCard key={i} tool={tr.tool} data={tr.data} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Chat panel ─────────────────────────────────────────────────────────────────

export default function CustomerChatPage() {
  const [messages, setMessages] = useState([
    {
      id: newId(),
      role: 'assistant',
      content: "Hi! I'm BeepBite's assistant. I can help you find stores, browse menus, add items to your cart, and place orders. What would you like to do?",
      toolResults: [],
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const conversationId = useRef(newId());

  // Scroll to bottom whenever messages change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { id: newId(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setError(null);

    // Build history in the format the backend expects (role + content only).
    const history = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const { data, error: apiErr } = await sendChatMessage(history, conversationId.current);
    setLoading(false);

    if (apiErr) {
      setError(apiErr.message || 'Something went wrong. Please try again.');
      return;
    }

    const assistantMsg = {
      id: newId(),
      role: 'assistant',
      content: data?.reply || '',
      toolResults: data?.tool_results || [],
    };
    setMessages((prev) => [...prev, assistantMsg]);
  }, [input, loading, messages]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto bg-gray-50">
      {/* Header */}
      <div className="bg-indigo-600 text-white px-4 py-3 flex items-center gap-3 shadow">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-lg">
          B
        </div>
        <div>
          <div className="font-semibold">BeepBite Assistant</div>
          <div className="text-xs text-indigo-200">Find stores, order food, track deliveries</div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {loading && (
          <div className="flex justify-start mb-3">
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-2 text-sm text-gray-400">
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
        {error && (
          <div className="text-center text-sm text-red-500 py-2">{error}</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t bg-white px-4 py-3">
        <div className="flex gap-2">
          <textarea
            className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 max-h-32"
            rows={1}
            placeholder="Ask me anything — find a store, add to cart, confirm order..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="bg-indigo-600 text-white rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40 hover:bg-indigo-700 transition-colors"
          >
            Send
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">Press Enter to send, Shift+Enter for newline</p>
      </div>
    </div>
  );
}
