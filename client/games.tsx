import type { ComponentType } from "react";
import type { RoomAction, RoomView } from "../shared/room";
import type { LLView } from "../shared/love-letter";
import { LoveLetterTable } from "./table";
export interface TableProps {
  room: RoomView;
  me: string;
  busy: boolean;
  onAction: (action: RoomAction) => void;
}
// This is the only game-specific UI boundary. The room transport stays opaque.
export const tables: Record<string, ComponentType<TableProps>> = {
  "love-letter": (props) => (
    <LoveLetterTable {...props} room={props.room as RoomView<LLView>} />
  ),
};
