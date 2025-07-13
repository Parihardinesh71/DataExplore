export interface TransactionDetail {
  particular: string;
  qty: string;
  rate: number;
  amount: number;
}

export interface Transaction {
  id: string;
  item: string;
  amount: number;
  type: 'credit' | 'debit';
  timestamp: Date;
  details?: TransactionDetail[];
  memoNumber?: number;
  paymentSource?: string;
}

export interface ParsedTransaction {
  item: string;
  amount: number;
  type: 'credit' | 'debit';
  details?: TransactionDetail[];
}

export interface CustomerInfo {
  name: string;
  phone: string;
  isMonthlyPayer?: boolean;
}

export interface Customer extends CustomerInfo {
    id: string;
    balance: number;
    transactions: Transaction[];
    isFavourite?: boolean;
}

export interface StoreInfo {
  name:string;
  phone: string;
}

export interface ShareContext {
  previousBalance: number;
  amountPaid: number;
  newBalance: number;
}

export interface ManualTransactionPayload {
  item: string;
  amount: number;
  type: 'credit' | 'debit';
}

export interface MemoPayload {
    customerName: string;
    items: TransactionDetail[];
    totalAmount: number;
}