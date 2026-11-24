import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Đã xảy ra lỗi không mong muốn.',
    };
  }

  render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed?.error) {
          friendly = `Lỗi truy cập dữ liệu (${parsed.operationType || 'read'}): ${parsed.error}`;
        }
      } catch {
        // non-JSON error message
      }

      return (
        <div className="min-h-screen bg-[#F6F8F7] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#DAE5E0] rounded-2xl p-8 space-y-4 shadow-xs">
            <h1 className="font-serif text-2xl font-semibold text-[#0D221D]">
              Không thể hiển thị màn hình
            </h1>
            <p className="text-sm text-[#4A615A] leading-relaxed break-words">{friendly}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2.5 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] transition-colors cursor-pointer"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
