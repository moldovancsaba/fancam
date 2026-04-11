/**
 * Collapsible Sidebar Component
 * Version: 1.0.0
 * 
 * Admin sidebar navigation with collapse/expand functionality
 * and version display at the bottom.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_VERSION } from '@/lib/app-version';

interface CollapsibleSidebarProps {
  session: {
    user: {
      name?: string;
      email: string;
      role?: string;
    };
    appRole?: 'none' | 'user' | 'admin' | 'superadmin';
  };
}

export default function CollapsibleSidebar({ session }: CollapsibleSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const pathname = usePathname();

  const navItems = [
    { href: '/admin', icon: '📊', label: 'Dashboard' },
    { href: '/admin/partners', icon: '🤝', label: 'Partners' },
    { href: '/admin/events', icon: '🎯', label: 'Events' },
    { href: '/admin/frames', icon: '🖼️', label: 'Frames' },
    { href: '/admin/logos', icon: '🎨', label: 'Logos' },
    { href: '/admin/submissions', icon: '📷', label: 'Submissions' },
    { href: '/admin/users', icon: '👥', label: 'Users' },
  ];

  return (
    <>
      {/* Sidebar */}
      <aside 
        className={`${
          isCollapsed ? 'w-20' : 'w-64'
        } bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transition-all duration-300 relative`}
      >
        {/* Toggle Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-6 z-10 w-6 h-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="text-xs">{isCollapsed ? '→' : '←'}</span>
        </button>

        {/* Logo */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <Link href="/" className="flex items-center gap-3">
            <img 
              src="https://i.ibb.co/zTG7ztxC/camera-logo.png" 
              alt="Camera Logo" 
              className="h-10 w-10 flex-shrink-0"
            />
            {!isCollapsed && (
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">Camera</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">Admin Panel</p>
              </div>
            )}
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors ${
                  isActive ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : ''
                }`}
                title={isCollapsed ? item.label : undefined}
              >
                <span className="text-xl flex-shrink-0">{item.icon}</span>
                {!isCollapsed && <span className="font-medium">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User Info & Version */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <div className={`${isCollapsed ? 'px-2' : 'px-4'} py-3 bg-gray-50 dark:bg-gray-900 rounded-lg`}>
            {!isCollapsed ? (
              <>
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {session.user.name || session.user.email}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{session.appRole || 'user'}</p>
              </>
            ) : (
              <div className="text-center">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold mx-auto">
                  {(session.user.name || session.user.email).charAt(0).toUpperCase()}
                </div>
              </div>
            )}
          </div>
          
          {!isCollapsed && (
            <>
              <Link
                href="/"
                className="mt-2 flex items-center justify-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                ← Back to App
              </Link>
              
              {/* Version Number */}
              <div className="mt-3 text-center">
                <p className="text-xs text-gray-400 dark:text-gray-600 font-mono">
                  v{APP_VERSION}
                </p>
              </div>
            </>
          )}
          
          {isCollapsed && (
            <div className="mt-2 text-center">
              <p className="text-[10px] text-gray-400 dark:text-gray-600 font-mono">
                v{APP_VERSION}
              </p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
