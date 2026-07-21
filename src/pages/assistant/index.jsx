import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  MessageSquare,
  Send,
  Bot,
  User,
  Loader2,
  CheckCircle,
  XCircle,
  FileText,
  SkipForward,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useMoney } from '@/context/locale-context';
import {
  sendMessage,
  commitDraft,
  discardDraft,
} from '@/services/assistant';
import { cn } from '@/lib/utils';

// ─── Message types ────────────────────────────────────────────────────────────

function SystemMessage({ text }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Bot className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 bg-muted rounded-xl rounded-tl-sm px-4 py-3 text-sm whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

function UserMessage({ text }) {
  return (
    <div className="flex gap-3 items-start flex-row-reverse">
      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
        <User className="w-4 h-4 text-primary-foreground" />
      </div>
      <div className="flex-1 bg-primary text-primary-foreground rounded-xl rounded-tr-sm px-4 py-3 text-sm text-right whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

// ─── Draft review panel ───────────────────────────────────────────────────────

function DraftPanel({ draft, locationId, onCommitted, onDiscarded }) {
  const [decisions, setDecisions] = useState(() => {
    const items = Array.isArray(draft.items) ? draft.items : [];
    return items.map((suggestion) => ({
      generated_item: suggestion.generated_item || suggestion,
      action: suggestion.recommendation || 'create_new',
      existing_item_id: suggestion.similar_items?.[0]?.existing_item?.id || '',
      modifications: null,
    }));
  });
  const [committing, setCommitting] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [result, setResult] = useState(null);
  // Draft item prices arrive as major-unit decimals, so they are parsed against
  // the active currency: a fixed two decimals misreads a JPY or KWD price.
  const { format: formatMoney, parse: parseMoney } = useMoney();

  const setAction = (idx, action) => {
    setDecisions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], action };
      return next;
    });
  };

  const handleCommit = async () => {
    setCommitting(true);
    const { data, error } = await commitDraft(draft.id, decisions);
    setCommitting(false);
    if (error) {
      setResult({ ok: false, message: error.message || 'Commit failed.' });
      return;
    }
    setResult({
      ok: true,
      message: `Done! ${data?.stats?.items_created ?? 0} created, ${data?.stats?.items_updated ?? 0} updated.`,
    });
    onCommitted?.(data);
  };

  const handleDiscard = async () => {
    await discardDraft(draft.id);
    onDiscarded?.();
  };

  const actionLabel = {
    create_new: 'Create new',
    update: 'Update existing',
    skip: 'Skip',
  };
  const actionVariant = {
    create_new: 'default',
    update: 'outline',
    skip: 'ghost',
  };

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-600" />
            <CardTitle className="text-sm text-amber-800">
              Menu import draft — {decisions.length} items
            </CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-amber-600 hover:text-amber-800 hover:bg-amber-100"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse draft' : 'Expand draft'}
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="px-4 pb-4 space-y-3">
          {result ? (
            <div
              className={cn(
                'rounded-lg px-4 py-3 text-sm flex items-center gap-2',
                result.ok
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800',
              )}
            >
              {result.ok ? (
                <CheckCircle className="w-4 h-4 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 shrink-0" />
              )}
              {result.message}
            </div>
          ) : (
            <>
              <p className="text-xs text-amber-700">
                Review each item and choose an action before committing.
              </p>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {decisions.map((d, idx) => {
                  const item = d.generated_item || {};
                  return (
                    <div
                      key={idx}
                      className="bg-card border rounded-lg px-3 py-2 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name || '—'}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.category_path?.join(' › ') || ''}{' '}
                          {item.price != null && parseMoney(item.price) != null
                            ? `· ${formatMoney(parseMoney(item.price))}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {['create_new', 'update', 'skip'].map((act) => (
                          <Button
                            key={act}
                            size="sm"
                            variant={d.action === act ? 'default' : 'outline'}
                            className="h-7 px-2 text-xs"
                            onClick={() => setAction(idx, act)}
                            aria-pressed={d.action === act}
                          >
                            {act === 'create_new' ? (
                              <RefreshCw className="w-3 h-3 mr-1" />
                            ) : act === 'update' ? (
                              <CheckCircle className="w-3 h-3 mr-1" />
                            ) : (
                              <SkipForward className="w-3 h-3 mr-1" />
                            )}
                            {actionLabel[act]}
                          </Button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={handleCommit}
                  disabled={committing}
                  className="flex-1"
                >
                  {committing ? (
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle className="w-3 h-3 mr-2" />
                  )}
                  Commit to menu
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDiscard}
                  disabled={committing}
                >
                  <Trash2 className="w-3 h-3 mr-2" />
                  Discard
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Message list entry ───────────────────────────────────────────────────────

function MessageEntry({ msg, locationId, onCommitted, onDiscarded }) {
  if (msg.role === 'user') {
    return <UserMessage text={msg.content} />;
  }
  // Assistant message.
  return (
    <div className="space-y-3">
      {msg.content && <SystemMessage text={msg.content} />}
      {msg.draft && (
        <div className="ml-11">
          <DraftPanel
            draft={msg.draft}
            locationId={locationId}
            onCommitted={onCommitted}
            onDiscarded={onDiscarded}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AssistantPage() {
  const { activeLocation } = useAuth();
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hi! I\'m your store assistant. You can use slash commands like /86 <item>, /price <item> <amount>, or /sales. Or just chat naturally — try "list all items" or "what\'s low on stock?".',
      draft: null,
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const userMsg = { id: Date.now() + '-u', role: 'user', content: text, draft: null };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    const { data, error } = await sendMessage({
      message: text,
      location_id: activeLocation?.id || '',
    });

    setSending(false);

    if (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + '-err',
          role: 'assistant',
          content: `Error: ${error.message || 'Something went wrong.'}`,
          draft: null,
        },
      ]);
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now() + '-a',
        role: 'assistant',
        content: data?.reply || '',
        draft: data?.draft || null,
      },
    ]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCommitted = (msgId) => (_result) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, content: m.content + '\n\nMenu committed successfully!', draft: null }
          : m,
      ),
    );
  };

  const handleDiscarded = (msgId) => () => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, draft: null } : m,
      ),
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-2xl mx-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
          <MessageSquare className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Store Assistant</h1>
          {activeLocation && (
            <p className="text-xs text-muted-foreground">{activeLocation.name}</p>
          )}
        </div>
        <Badge variant="outline" className="ml-auto text-xs">
          WhatsApp-style
        </Badge>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-2">
        {messages.map((msg) => (
          <MessageEntry
            key={msg.id}
            msg={msg}
            locationId={activeLocation?.id || ''}
            onCommitted={handleCommitted(msg.id)}
            onDiscarded={handleDiscarded(msg.id)}
          />
        ))}

        {sending && (
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="bg-muted rounded-xl rounded-tl-sm px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <form onSubmit={handleSend} className="flex gap-2 pt-3 border-t">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message or /86 <item>…"
          disabled={sending}
          className="flex-1"
          autoComplete="off"
        />
        <Button type="submit" size="icon" disabled={!input.trim() || sending}>
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
