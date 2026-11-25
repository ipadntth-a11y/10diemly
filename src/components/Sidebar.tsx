import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  GraduationCap,
  LayoutGrid,
  LogOut,
  Menu,
  MessageSquare,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { TeacherNavTab } from '../types';

interface SidebarProps {
  activeTab: TeacherNavTab;
  onSelectTab: (tab: TeacherNavTab) => void;
  userEmail: string;
  onBackHome: () => void;
  onSignOut: () => void;
}

const NAV_ITEMS: { id: TeacherNavTab; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutGrid },
  { id: 'classes', label: 'Lớp & học sinh', icon: GraduationCap },
  { id: 'exams', label: 'Đề & bài chấm', icon: BookOpen },
  { id: 'reference_bank', label: 'Kho chuẩn AI', icon: BookMarked },
  { id: 'messages', label: 'Tin nhắn phụ huynh', icon: MessageSquare },
];

export function Sidebar({
  activeTab,
  onSelectTab,
  userEmail,
  onBackHome,
  onSignOut,
}: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navContent = (
    <div className="flex flex-col justify-between h-full py-6 px-4 text-white">
      <div>
        <div className="flex items-center gap-3 px-2 mb-8 pb-5 border-b border-[#C89B2B]/25">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#E5C665] via-[#C89B2B] to-[#9E7514] text-[#082B23] font-serif font-bold text-base flex items-center justify-center shrink-0 ring-1 ring-[#F4DE96]/50">
            10
          </div>
          <div className="min-w-0">
            <div className="font-serif font-semibold text-base text-white leading-tight">
              Điểm 10
            </div>
            <div className="text-[11px] font-semibold tracking-[0.1em] text-[#E5C665] mt-0.5 uppercase">
              Giáo viên
            </div>
          </div>
        </div>

        <nav className="space-y-1.5" aria-label="Điều hướng giáo viên">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectTab(item.id);
                  setMobileOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-[#124E40] text-[#F7E5A9] font-semibold ring-1 ring-[#C89B2B]/45'
                    : 'text-[#C8DCD5] hover:bg-[#104539] hover:text-white'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#E5C665]' : 'text-[#8BB5A8]'}`}
                  strokeWidth={1.9}
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="pt-5 border-t border-[#C89B2B]/25 space-y-2 px-2">
        <div className="text-xs text-[#9DC1B5] truncate pb-1" title={userEmail}>
          {userEmail}
        </div>
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false);
            onBackHome();
          }}
          className="w-full flex items-center gap-2.5 py-1.5 text-sm text-[#D1E3DD] hover:text-[#F7E5A9] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 shrink-0 text-[#C89B2B]" strokeWidth={1.8} />
          <span>Cổng đăng nhập</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false);
            onSignOut();
          }}
          className="w-full flex items-center gap-2.5 py-1.5 text-sm text-[#D1E3DD] hover:text-[#FCA5A5] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <LogOut className="w-4 h-4 shrink-0 text-[#9DC1B5]" strokeWidth={1.8} />
          <span>Đăng xuất</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile compact header */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0A362C] border-b border-[#C89B2B]/30 sticky top-0 z-30 text-white">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#E5C665] via-[#C89B2B] to-[#9E7514] text-[#082B23] font-serif font-bold text-sm flex items-center justify-center">
            10
          </div>
          <span className="font-serif font-semibold text-base text-white">
            Điểm 10
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="p-2 rounded-lg text-[#D1E3DD] hover:bg-[#124E40] cursor-pointer"
          aria-label="Mở menu"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="w-64 bg-[#0A362C] border-r border-[#C89B2B]/30 h-full shadow-xl">
            {navContent}
          </div>
          <button
            type="button"
            aria-label="Đóng menu"
            className="flex-1 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      {/* Desktop persistent sidebar */}
      <aside className="hidden lg:block w-60 shrink-0 bg-[#0A362C] border-r border-[#C89B2B]/25 min-h-screen sticky top-0 h-screen">
        {navContent}
      </aside>
    </>
  );
}
