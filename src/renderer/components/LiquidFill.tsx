import React from 'react';
import { Box, keyframes } from '@mui/material';
import { alpha, lighten, useTheme } from '@mui/material/styles';

// Liquid that fills its (position: relative) parent from the bottom up to `progress`%,
// with a gently drifting wave on top. Built from an SVG wave strip of fixed pixel height,
// so it reads the same in a 40px pill, a progress card or a round loader - unlike the
// rotating-square trick, whose wave size scales with the container.

const drift = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
`;

// Four half-waves across the strip: translating by -50% (one full period) loops seamlessly
const WAVE_PATH = 'M0 5 Q15 0 30 5 T60 5 T90 5 T120 5 V10 H0 Z';

interface WaveProps {
  color: string;
  height: number;
  duration: number;
  reverse?: boolean;
}

function Wave({ color, height, duration, reverse = false }: WaveProps) {
  return (
    <Box
      sx={{
        position: 'absolute',
        left: 0,
        bottom: '100%',
        width: '200%',
        height,
        mb: '-1px', // overlap the body so no hairline shows between them
        animation: `${drift} ${duration}s linear infinite`,
        animationDirection: reverse ? 'reverse' : 'normal',
      }}
    >
      <svg
        viewBox="0 0 120 10"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        aria-hidden
        style={{ display: 'block' }}
      >
        <path d={WAVE_PATH} fill={color} />
      </svg>
    </Box>
  );
}

interface LiquidFillProps {
  progress: number; // 0-100
  color: string;
  opacity?: number;
  waveHeight?: number; // px
  // Animate the level itself (loaders): rises and falls instead of following `progress`
  indeterminate?: boolean;
}

const slosh = keyframes`
  0%, 100% { height: 25%; }
  50% { height: 75%; }
`;

export default function LiquidFill({
  progress,
  color,
  opacity = 1,
  waveHeight = 6,
  indeterminate = false,
}: LiquidFillProps) {
  const level = Math.min(100, Math.max(0, progress));
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        borderRadius: 'inherit',
        pointerEvents: 'none',
        opacity,
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: `${level}%`,
          bgcolor: color,
          transition: 'height 1s cubic-bezier(0.4, 0, 0.2, 1)',
          ...(indeterminate && {
            animation: `${slosh} 2.4s ease-in-out infinite`,
          }),
        }}
      >
        {/* Back wave: lighter and slower, drifting the other way, for depth */}
        <Wave
          color={alpha(lighten(color, 0.3), 0.7)}
          height={waveHeight * 1.3}
          duration={7}
          reverse
        />
        <Wave color={color} height={waveHeight} duration={4} />
      </Box>
    </Box>
  );
}

// Round liquid loader for views that are still loading
export function LiquidLoader({
  color,
  size = 56,
  label,
}: {
  color?: string;
  size?: number;
  label?: string;
}) {
  const theme = useTheme();
  return (
    <Box
      role="progressbar"
      aria-label={label || 'Loading'}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        py: 4,
        width: '100%',
        height: '100%',
      }}
    >
      <Box
        sx={{
          position: 'relative',
          width: size,
          height: size,
          borderRadius: '50%',
          bgcolor: alpha(theme.palette.text.primary, 0.06),
          boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.08)}`,
        }}
      >
        <LiquidFill
          progress={50}
          indeterminate
          color={color || theme.palette.secondary.main}
          waveHeight={5}
        />
      </Box>
      {label && (
        <Box
          component="span"
          sx={{ color: 'text.secondary', fontSize: '0.8rem', fontWeight: 500 }}
        >
          {label}
        </Box>
      )}
    </Box>
  );
}
