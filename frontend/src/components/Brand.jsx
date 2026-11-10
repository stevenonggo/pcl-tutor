import React from 'react';
import logoUrl from '../assets/pcl-tutor-logo.png';

/**
 * PCL Tutor brand mark.
 *
 * Renders the official PCL Tutor logo image (bundled, unmodified). It is scaled
 * inside the square mark box with object-fit:contain so the logo's aspect ratio
 * is preserved at every placement (sidebar and login page).
 */
function BrandMark() {
  return <img className="brand-logo" src={logoUrl} alt="PCL Tutor" />;
}

export default function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`} aria-label="PCL Tutor">
      <span className="brand-mark" aria-hidden="true">
        <BrandMark />
      </span>
      {!compact && (
        <span className="brand-wordmark">
          <strong>PCL</strong> Tutor
        </span>
      )}
    </div>
  );
}