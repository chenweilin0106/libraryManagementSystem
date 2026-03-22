import type { BorrowsApi } from '#/api';

export type BorrowStatus = BorrowsApi.BorrowStatus;
export type BorrowStatusTagType = 'danger' | 'info' | 'success' | 'warning';

export function borrowStatusLabel(status: BorrowStatus) {
  switch (status) {
    case 'reserved':
      return '待取书';
    case 'reserve_overdue':
      return '待取超期';
    case 'borrowed':
      return '借阅中';
    case 'borrow_overdue':
      return '借阅逾期';
    case 'returned':
      return '已归还';
    case 'canceled':
      return '已取消';
    default:
      return status;
  }
}

export function borrowStatusTagType(status: BorrowStatus): BorrowStatusTagType {
  switch (status) {
    case 'reserved':
      return 'warning';
    case 'reserve_overdue':
    case 'borrow_overdue':
      return 'danger';
    case 'borrowed':
      return 'success';
    default:
      return 'info';
  }
}

