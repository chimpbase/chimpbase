export const ORDER_STATUSES = ["pending", "in_progress", "quality_check", "completed", "rejected"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

export interface ProductionOrderRecord {
  id: number;
  factory_id: number;
  factory_code: string;
  factory_name: string;
  product_sku: string;
  quantity: number;
  status: OrderStatus;
  priority: OrderPriority;
  operator_email: string | null;
  started_at: string | null;
  completed_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOrderInput {
  factoryCode: string;
  productSku: string;
  quantity: number;
  priority?: string;
  operatorEmail?: string | null;
}

export interface NormalizedCreateOrderInput {
  factoryCode: string;
  productSku: string;
  quantity: number;
  priority: OrderPriority;
  operatorEmail: string | null;
}

export interface OrderListFilters {
  factoryCode?: string;
  status?: string;
  priority?: string;
  operatorEmail?: string;
}

export interface NormalizedOrderListFilters {
  factoryCode: string | null;
  status: OrderStatus | null;
  priority: OrderPriority | null;
  operatorEmail: string | null;
}

export interface ProductionDashboard {
  total: number;
  pending: number;
  in_progress: number;
  quality_check: number;
  completed: number;
  rejected: number;
  assigned: number;
}

export interface OrderAuditRecord {
  id: number;
  event_name: string;
  order_id: number;
  factory_code: string;
  product_sku: string;
  status: OrderStatus;
  operator_email: string | null;
  created_at: string;
}

export interface OrderNotificationRecord {
  id: number;
  queue_name: string;
  order_id: number;
  factory_code: string;
  product_sku: string;
  recipient_email: string | null;
  sender_email: string;
  created_at: string;
}

export interface QualityReportRecord {
  id: string;
  orderId: number;
  inspector: string;
  passed: boolean;
  notes: string;
  createdAt: string;
}

export interface ProductionSnapshotRecord {
  id: string;
  capturedAt: string;
  schedule: string;
  summary: ProductionDashboard;
}

export interface FactorySettingRecord {
  key: string;
  value: unknown;
}

export interface ProductionActivityStreamEvent {
  createdAt: string;
  event: string;
  id: number;
  payload: {
    factoryCode: string;
    operatorEmail: string | null;
    orderId: number;
    productSku: string;
    status: OrderStatus;
  };
  stream: string;
}

export interface SeedFactoryDataResult {
  factories: unknown[];
  orders: ProductionOrderRecord[];
}
