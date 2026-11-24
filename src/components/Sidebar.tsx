import {
  ArrowLeft,
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
    <div className="flex flex-col justify-between h-full py-6 px-4">
      <div>
        <div className="flex items-center gap-3 px-2 mb-8">
          <div className="w-10 h-10 rounded-full bg-[#1E4D43] text-white font-serif font-bold text-base flex items-center justify-center shrink-0">
            10
          </div>
          <div className="min-w-0">
            <div className="font-serif font-semibold text-base text-[#16231F] leading-tight">
              Điểm 10
            </div>
            <div className="text-[11px] font-medium tracking-[0.08em] text-[#66706C] mt-0.5">
              GIÁO VIÊN
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
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[#E5ECE7] text-[#1E4D43] font-medium'
                    : 'text-[#434D49] hover:bg-[#ECEAE4] hover:text-[#16231F]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" strokeWidth={1.9} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="pt-5 border-t border-[#E4E2DC] space-y-2 px-2">
        <div className="text-xs text-[#66706C] truncate pb-1" title={userEmail}>
          {userEmail}
        </div>
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false);
            onBackHome();
          }}
          className="w-full flex items-center gap-2.5 py-1.5 text-sm text-[#434D49] hover:text-[#16231F] transition-colors whitespace-nowrap cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" strokeWidth={1.8} />
          <span>Cổng đăng nhập</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false);
            onSignOut();
          }}
          className="w-full flex items-center gap-2.5 py-1.5 text-sm text-[#434D49] hover:text-[#B91C1C] transition-colors whitespace-nowrap cursor-pointer"
        >
          <LogOut className="w-4 h-4 shrink-0" strokeWidth={1.8} />
          <span>Đăng xuất</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile compact header */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#F5F4F0] border-b border-[#E7E5DF] sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#1E4D43] text-white font-serif font-bold text-sm flex items-center justify-center">
            10
          </div>
          <span className="font-serif font-semibold text-base text-[#16231F]">
            Điểm 10
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="p-2 rounded-lg text-[#434D49] hover:bg-[#ECEAE4] cursor-pointer"
          aria-label="Mở menu"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="w-64 bg-[#F5F4F0] border-r border-[#E7E5DF] h-full shadow-xl">
            {navContent}
          </div>
          <button
            type="button"
            aria-label="Đóng menu"
            className="flex-1 bg-black/30"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      {/* Desktop persistent sidebar */}
      <aside className="hidden lg:block w-60 shrink-0 bg-[#F5F4F0] border-r border-[#E7E5DF] min-h-screen sticky top-0 h-screen">
        {navContent}
      </aside>
    </>
  );
}
