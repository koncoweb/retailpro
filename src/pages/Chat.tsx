import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useArchiveChannel,
  useConversation,
  useConversations,
} from "@/hooks/use-chat";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ConversationList } from "@/components/chat/ConversationList";
import { MessagePane } from "@/components/chat/MessagePane";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { NewChannelDialog } from "@/components/chat/NewChannelDialog";
import { AddDmDialog } from "@/components/chat/AddDmDialog";

/**
 * The internal chat screen: a Slack-style two-pane workspace.
 *
 * Selection lives here so both the rail and the thread read from one source of
 * truth, and so mobile can collapse to a single pane without the components
 * knowing about the viewport. A background tab pauses polling and only the open
 * conversation polls quickly, which is the whole point of the polling model — see
 * `use-chat.ts`. There is no row-level security, so this is coordination space,
 * not a confidential one (docs/spec-chat-internal.md).
 */
export default function Chat() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const isMobile = useIsMobile();
  const canManage = can("manage_channels");

  const conversations = useConversations();
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useConversation(activeId);

  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newDmOpen, setNewDmOpen] = useState(false);
  const archive = useArchiveChannel();

  // On desktop, open the most recent conversation the first time the list lands.
  useEffect(() => {
    if (isMobile || activeId) return;
    const first = conversations.data?.[0];
    if (first) setActiveId(first.id);
  }, [isMobile, activeId, conversations.data]);

  const selectAndClose = (id: string) => {
    setActiveId(id);
    setNewChannelOpen(false);
    setNewDmOpen(false);
  };

  const handleArchive = (id: string) =>
    archive.mutate(
      { conversationId: id, archived: true },
      {
        onSuccess: () => {
          toast.success("Channel diarsipkan.");
          if (activeId === id) setActiveId(null);
        },
        onError: () => toast.error("Gagal mengarsipkan channel."),
      }
    );

  if (!user) return null;

  const conversation = active.data ?? null;

  // While a conversation is selected but still loading, the pane shows a
  // skeleton instead of the "Pilih percakapan" panel. It must not show the
  // previous conversation: `useConversation` deliberately stopped keeping
  // previous data, and the composer sends to whichever pane is on screen.
  const thread = conversation ? (
    <MessagePane
      conversation={conversation}
      currentUserId={user.id}
      canManage={canManage}
      onBack={isMobile ? () => setActiveId(null) : undefined}
      onArchive={handleArchive}
    />
  ) : activeId ? (
    <ChatEmptyState skeleton />
  ) : (
    <ChatEmptyState />
  );

  const list = (
    <ConversationList
      conversations={conversations.data ?? []}
      loading={conversations.isLoading}
      activeId={activeId}
      currentUserId={user.id}
      canManage={canManage}
      onSelect={setActiveId}
      onNewChannel={() => setNewChannelOpen(true)}
      onNewDm={() => setNewDmOpen(true)}
    />
  );

  return (
    <BackOfficeLayout>
      <div className="flex h-[calc(100dvh-6.5rem)] flex-col overflow-hidden rounded-xl border bg-card">
        {isMobile ? (
          activeId ? (
            thread
          ) : (
            list
          )
        ) : (
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={24} minSize={18} maxSize={40}>
              {list}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={76} minSize={50}>
              {thread}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      <NewChannelDialog
        open={newChannelOpen}
        onOpenChange={setNewChannelOpen}
        onCreated={selectAndClose}
      />
      <AddDmDialog open={newDmOpen} onOpenChange={setNewDmOpen} onOpened={selectAndClose} />
    </BackOfficeLayout>
  );
}
