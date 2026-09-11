export type ChatChannel = "public" | "room";

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  roomId: string | null;
  sender: {
    playerId: string;
    name: string;
    avatarUrl: string | null;
  };
  text: string;
  createdAt: string;
}

export interface ChatHistory {
  messages: ChatMessage[];
}
