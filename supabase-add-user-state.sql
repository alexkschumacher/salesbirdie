/* style.css — Sales Activity Tracker Design Tokens & Component Styles */

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:root {
  /* Font families */
  --font-display: 'Inter', system-ui, sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;

  /* Type scale */
  --text-xs:   clamp(0.75rem,  0.7rem  + 0.25vw, 0.875rem);
  --text-sm:   clamp(0.875rem, 0.8rem  + 0.35vw, 1rem);
  --text-base: clamp(1rem,     0.9rem  + 0.5vw,  1.125rem);
  --text-lg:   clamp(1.125rem, 0.95rem + 0.85vw, 1.5rem);
  --text-xl:   clamp(1.5rem,   1rem    + 1.5vw,  2.25rem);
  --text-2xl:  clamp(2rem,     1.2rem  + 2.5vw,  3.5rem);

  /* Spacing (4px base) */
  --space-1:  0.25rem;
  --space-2:  0.5rem;
  --space-3:  0.75rem;
  --space-4:  1rem;
  --space-5:  1.25rem;
  --space-6:  1.5rem;
  --space-8:  2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-20: 5rem;
  --space-24: 6rem;
  --space-32: 8rem;

  /* Content widths */
  --content-narrow: 640px;
  --content-default: 960px;
  --content-wide: 1400px;
  --content-full: 100%;

  /* Radius */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-full: 9999px;

  /* Transitions */
  --transition-interactive: 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* LIGHT MODE */
:root, [data-theme="light"] {
  color-scheme: light;
  --color-bg:             #f7f6f2;
  --color-surface:        #f9f8f5;
  --color-surface-2:      #fbfbf9;
  --color-surface-offset: #f3f0ec;
  --color-surface-offset-2: #edeae5;
  --color-surface-dynamic: #e6e4df;
  --color-divider:        #dcd9d5;
  --color-border:         #d4d1ca;

  --color-text:           #28251d;
  --color-text-muted:     #7a7974;
  --color-text-faint:     #bab9b4;
  --color-text-inverse:   #f9f8f4;

  --color-primary:        #2e7d32;
  --color-primary-hover:  #1b5e20;
  --color-primary-active: #144d19;
  --color-primary-highlight: #c8e6c9;

  --color-warning:        #964219;
  --color-warning-hover:  #713417;
  --color-warning-active: #4b2614;
  --color-warning-highlight: #ddcfc6;

  --color-error:          #a12c7b;
  --color-error-hover:    #7d1e5e;
  --color-error-active:   #561740;
  --color-error-highlight: #e0ced7;

  --color-success:        #437a22;
  --color-success-hover:  #2e5c10;
  --color-success-active: #1e3f0a;
  --color-success-highlight: #d4dfcc;

  --shadow-sm: 0 1px 2px oklch(0.2 0.01 80 / 0.06);
  --shadow-md: 0 4px 12px oklch(0.2 0.01 80 / 0.08);
  --shadow-lg: 0 12px 32px oklch(0.2 0.01 80 / 0.12);
}

/* DARK MODE */
[data-theme="dark"] {
  color-scheme: dark;
  --color-bg:             #171614;
  --color-surface:        #1c1b19;
  --color-surface-2:      #201f1d;
  --color-surface-offset: #1d1c1a;
  --color-surface-offset-2: #22211f;
  --color-surface-dynamic: #2d2c2a;
  --color-divider:        #262523;
  --color-border:         #393836;

  --color-text:           #cdccca;
  --color-text-muted:     #797876;
  --color-text-faint:     #5a5957;
  --color-text-inverse:   #2b2a28;

  --color-primary:        #66bb6a;
  --color-primary-hover:  #43a047;
  --color-primary-active: #2e7d32;
  --color-primary-highlight: #2e3b2e;

  --color-warning:        #bb653b;
  --color-warning-hover:  #b95525;
  --color-warning-active: #993d10;
  --color-warning-highlight: #564942;

  --color-error:          #d163a7;
  --color-error-hover:    #b9478f;
  --color-error-active:   #9b2f76;
  --color-error-highlight: #4c3d46;

  --color-success:        #6daa45;
  --color-success-hover:  #4d8f25;
  --color-success-active: #387015;
  --color-success-highlight: #3a4435;

  --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.2);
  --shadow-md: 0 4px 12px oklch(0 0 0 / 0.3);
  --shadow-lg: 0 12px 32px oklch(0 0 0 / 0.4);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    color-scheme: dark;
    --color-bg:             #171614;
    --color-surface:        #1c1b19;
    --color-surface-2:      #201f1d;
    --color-surface-offset: #1d1c1a;
    --color-surface-offset-2: #22211f;
    --color-surface-dynamic: #2d2c2a;
    --color-divider:        #262523;
    --color-border:         #393836;
    --color-text:           #cdccca;
    --color-text-muted:     #797876;
    --color-text-faint:     #5a5957;
    --color-text-inverse:   #2b2a28;
    --color-primary:        #66bb6a;
    --color-primary-hover:  #43a047;
    --color-primary-active: #2e7d32;
    --color-primary-highlight: #2e3b2e;
    --color-warning:        #bb653b;
    --color-warning-hover:  #b95525;
    --color-warning-active: #993d10;
    --color-warning-highlight: #564942;
    --color-error:          #d163a7;
    --color-error-hover:    #b9478f;
    --color-error-active:   #9b2f76;
    --color-error-highlight: #4c3d46;
    --color-success:        #6daa45;
    --color-success-hover:  #4d8f25;
    --color-success-active: #387015;
    --color-success-highlight: #3a4435;
    --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.2);
    --shadow-md: 0 4px 12px oklch(0 0 0 / 0.3);
    --shadow-lg: 0 12px 32px oklch(0 0 0 / 0.4);
  }
}
