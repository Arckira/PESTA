import React, { useState } from 'react';

const PageHeader = ({ categoria, titulo, actionText, onActionClick, secondaryActionText, onSecondaryActionClick, isDashboard }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isSecHovered, setIsSecHovered] = useState(false);

  const SECONDARY_BTN_STYLE = {
    borderRadius: '6px',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.04em',
    backgroundColor: '#ffffff',
    color: '#374151',
    border: '1px solid #d1d5db',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    transition: 'all 0.15s ease-in-out',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '12px',
  };

  const SECONDARY_BTN_HOVER_STYLE = {
    ...SECONDARY_BTN_STYLE,
    backgroundColor: '#f9fafb',
    borderColor: '#9ca3af',
    boxShadow: '0 2px 5px rgba(0,0,0,0.12)',
    transform: 'translateY(-0.5px)',
  };

  const BTN_STYLE = {
    borderRadius: '6px',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: '750',
    letterSpacing: '0.04em',
    backgroundColor: '#d60a16',
    color: '#ffffff',
    boxShadow: '0 2px 5px rgba(214, 10, 22, 0.25), 0 1px 2px rgba(0, 0, 0, 0.08)',
    transition: 'all 0.15s ease-in-out',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none'
  };

  const BTN_HOVER_STYLE = {
    ...BTN_STYLE,
    backgroundColor: '#b00812',
    boxShadow: '0 4px 8px rgba(214, 10, 22, 0.35)',
    transform: 'translateY(-0.5px)'
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-5 animate-fade-in" style={{ marginBottom: '40px', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {categoria && (
          <span style={{ fontSize: '14px', fontWeight: '700', letterSpacing: '0.05em', color: '#d60a16', textTransform: 'uppercase' }}>
            {categoria}
          </span>
        )}
        <h1 style={{ fontSize: isDashboard ? '24px' : '18px', fontWeight: '700', letterSpacing: '0.02em', color: '#111827', textTransform: 'uppercase', margin: 0 }}>
          {titulo}
        </h1>
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        {secondaryActionText && onSecondaryActionClick && (
          <button
            onClick={onSecondaryActionClick}
            type="button"
            onMouseEnter={() => setIsSecHovered(true)}
            onMouseLeave={() => setIsSecHovered(false)}
            style={isSecHovered ? SECONDARY_BTN_HOVER_STYLE : SECONDARY_BTN_STYLE}
          >
            <svg
              style={{ width: '14px', height: '14px', marginRight: '6px', flexShrink: 0 }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
            <span>{secondaryActionText}</span>
          </button>
        )}
        {actionText && onActionClick && (
          <button
            onClick={onActionClick}
            type="button"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={isHovered ? BTN_HOVER_STYLE : BTN_STYLE}
          >
            <svg
              style={{ width: '15px', height: '15px', marginRight: '6px', flexShrink: 0 }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 4v16m8-8H4" />
            </svg>
            <span>{actionText}</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default PageHeader;
