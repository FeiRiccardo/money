export type TxType = 'expense' | 'income';
export type Language = 'en' | 'it';
export type Frequency = 'weekly' | 'monthly' | 'yearly';
export type SortOrder = 'newest' | 'oldest' | 'largest' | 'smallest';

export interface Category {
  id: string;
  type: TxType;
  /** Fallback/English name. Display uses `defaultKey` translation while it is set. */
  name: string;
  /** Set only while the Category is a still-translatable starter default. */
  defaultKey?: string;
  lastUsedAt: number;
}

export interface Transaction {
  id: string;
  /** Calendar date, YYYY-MM-DD, no time of day. */
  date: string;
  type: TxType;
  /** Always positive; `type` gives the direction. */
  cents: number;
  /** Live Category references. */
  categoryIds: string[];
  /** Retired labels: frozen names of deleted Categories. */
  retired: string[];
  note: string;
  /** When it was recorded; breaks ties between Transactions on the same date. */
  createdAt?: number;
  /** Set when a recurring rule created this Transaction (not part of the backup). */
  ruleId?: string;
}

/** A schedule that creates Transactions automatically when the app opens. */
export interface RecurringRule {
  id: string;
  type: TxType;
  cents: number;
  categoryIds: string[];
  retired: string[];
  note: string;
  frequency: Frequency;
  /** First occurrence, YYYY-MM-DD. Monthly and yearly rules keep this day of the month. */
  startDate: string;
  endDate: string | null;
  /** The next occurrence not yet created. */
  nextDate: string;
}

/** A receipt photo kept with a Transaction. */
export interface Attachment {
  id: string;
  transactionId: string;
  mime: string;
  data: ArrayBuffer;
  /** Orders the photos of one Transaction. */
  addedAt: number;
}

/** What is needed to add a photo; the ledger fills in the rest. */
export type AttachmentInput = Pick<Attachment, 'mime' | 'data'>;

export interface LedgerData {
  categories: Category[];
  transactions: Transaction[];
}

export interface Settings {
  language: Language;
  openingCents: number;
  /** False/absent means the database is empty and the first-run screen is shown. */
  onboarded: boolean;
  lastBackupAt: number | null;
  changesSinceBackup: number;
  /** Writes since the last save to Google Drive (every write, Undo included). */
  changesSinceDrive: number;
  backupBannerHiddenUntil: number;
  installNudgeHiddenUntil: number;
  persistRequested: boolean;
  /** Remembered ordering of Transaction lists. */
  sortOrder: SortOrder;
  /** The copy of the Drive backup this device last saved or restored; null when it knows none. */
  driveFile: DriveFile | null;
  /** When this device last saved to Google Drive. */
  driveSavedAt: number | null;
}

/** Which copy of the Drive backup file this is: Drive changes `modifiedTime` on every save. */
export interface DriveFile {
  id: string;
  modifiedTime: string;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  openingCents: 0,
  onboarded: false,
  lastBackupAt: null,
  changesSinceBackup: 0,
  changesSinceDrive: 0,
  backupBannerHiddenUntil: 0,
  installNudgeHiddenUntil: 0,
  persistRequested: false,
  sortOrder: 'newest',
  driveFile: null,
  driveSavedAt: null,
};

/** Starter Categories. `key` is stored as `defaultKey` and translated at display. */
export const STARTER_CATEGORIES: ReadonlyArray<{ type: TxType; key: string; name: string }> = [
  { type: 'expense', key: 'groceries', name: 'Groceries' },
  { type: 'expense', key: 'diningOut', name: 'Dining out' },
  { type: 'expense', key: 'transport', name: 'Transport' },
  { type: 'expense', key: 'housing', name: 'Housing' },
  { type: 'expense', key: 'utilities', name: 'Utilities' },
  { type: 'expense', key: 'health', name: 'Health' },
  { type: 'expense', key: 'entertainment', name: 'Entertainment' },
  { type: 'expense', key: 'shopping', name: 'Shopping' },
  { type: 'expense', key: 'otherExpense', name: 'Other' },
  { type: 'income', key: 'salary', name: 'Salary' },
  { type: 'income', key: 'gifts', name: 'Gifts' },
  { type: 'income', key: 'otherIncome', name: 'Other' },
];
