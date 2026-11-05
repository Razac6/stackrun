import { Theme, useTheme } from '@mui/material/styles';
import classicTheme from './classic';
import lumaTheme, { createLumaTheme, lumaDefaults, LumaColors } from './luma';

export type ThemeVariant = 'classic' | 'luma';

declare module '@mui/material/styles' {
  interface Theme {
    variant: ThemeVariant;
  }
  interface ThemeOptions {
    variant?: ThemeVariant;
  }
  // Status colors: `progress` = In Progress / active sprint, `review` = In Review.
  // `highlight` = Luma's dashboard highlight card, `band` = its dark Activity section.
  interface Palette {
    progress: Palette['primary'];
    review: Palette['primary'];
    highlight: Palette['primary'];
    band: Palette['primary'];
  }
  interface PaletteOptions {
    progress?: PaletteOptions['primary'];
    review?: PaletteOptions['primary'];
    highlight?: PaletteOptions['primary'];
    band?: PaletteOptions['primary'];
  }
}

declare module '@mui/material/Chip' {
  interface ChipPropsColorOverrides {
    progress: true;
    review: true;
  }
}

export const themes: Record<ThemeVariant, Theme> = {
  classic: classicTheme,
  luma: lumaTheme,
};

export const themeLabels: Record<ThemeVariant, string> = {
  classic: 'Classic',
  luma: 'Luma',
};

export const DEFAULT_THEME: ThemeVariant = 'classic';

// Settings keys holding Luma's user-picked brand colors
export const lumaColorSettings: Record<keyof LumaColors, string> = {
  primary: 'luma_primary',
  accent: 'luma_accent',
  highlight: 'luma_highlight',
  band: 'luma_band',
};

export const getLumaColors = (
  settings: Record<string, string | undefined>,
): LumaColors => ({
  primary: settings[lumaColorSettings.primary] || lumaDefaults.primary,
  accent: settings[lumaColorSettings.accent] || lumaDefaults.accent,
  highlight: settings[lumaColorSettings.highlight] || lumaDefaults.highlight,
  band: settings[lumaColorSettings.band] || lumaDefaults.band,
});

// The `ui_theme` setting may hold anything (old DBs, manual edits) - fall back to the default.
export const resolveTheme = (
  settings: Record<string, string | undefined>,
): Theme => {
  if (settings.ui_theme === 'luma') {
    return createLumaTheme(getLumaColors(settings));
  }
  return themes[settings.ui_theme as ThemeVariant] ?? themes[DEFAULT_THEME];
};

// For the few places where the layout itself (not just colors) differs between themes.
export const useIsLuma = () => useTheme().variant === 'luma';
