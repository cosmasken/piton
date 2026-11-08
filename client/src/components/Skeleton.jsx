import React from 'react';

export function Skeleton({ className = '' }) {
  return <div className={`bg-surface animate-pulse rounded ${className}`} />;
}

export function SkeletonRow() {
  return (
    <div className="border-b border-border px-4 py-2.5 flex items-center gap-3">
      <Skeleton className="w-16 h-3" />
      <Skeleton className="w-10 h-4 rounded-full" />
      <Skeleton className="w-20 h-3" />
      <Skeleton className="w-14 h-3" />
      <Skeleton className="w-12 h-3" />
    </div>
  );
}
