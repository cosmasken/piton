import React, { useEffect } from 'react';

export default function Modal({ title, onClose, children, width = 'w-96' }) {
  useEffect(() => {
    const handler = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`panel ${width} p-6 space-y-4 max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-display font-semibold text-text">{title}</p>
          <button onClick={onClose} className="text-dim hover:text-text transition-colors text-lg leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
