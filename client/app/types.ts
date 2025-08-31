export type Doc = {
  id: string;
  name: string;
  size?: number;
  pages?: number;
  status?: "queued" | "processing" | "ready" | "error" | "deleted" | "deleting";
  createdAt?: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  /** when true, render a typing bubble and hide actions */
  pending?: boolean;
};

export type Status =
  | "queued"
  | "processing"
  | "ready"
  | "error"
  | "deleted"
  | "deleting";

export type Props = {
  isOpen: boolean;
  onClose: () => void;
  docs: Doc[];
  activeId: string | null;
  onSelectDoc: (id: string) => void;
};

export type UploadModalProps = {
  open: boolean;
  onClose: () => void;
  onSelect?: (file: File) => void | Promise<void>;
  onUploaded?: (uploaded: Doc[]) => void;
  emitGlobalEvent?: boolean;
  title?: string;
  accept?: string;
  helperText?: string;
};

