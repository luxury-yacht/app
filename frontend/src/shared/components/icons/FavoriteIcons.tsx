import React from 'react';
import type { IconProps } from './SharedIcons';

export const FavoriteOutlineIcon: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill={fill}
    width={width}
    height={height}
  >
    <path d="m12 21l-1.45-1.3q-2.525-2.275-4.175-3.925T3.75 12.812T2.388 10.4T2 8.15Q2 5.8 3.575 4.225T7.5 2.65q1.3 0 2.475.55T12 4.75q.85-1 2.025-1.55t2.475-.55q2.35 0 3.925 1.575T22 8.15q0 1.15-.387 2.25t-1.363 2.412t-2.625 2.963T13.45 19.7zm0-2.7q2.4-2.15 3.95-3.687t2.45-2.675t1.25-2.026T20 8.15q0-1.5-1-2.5t-2.5-1q-1.175 0-2.175.662T12.95 7h-1.9q-.375-1.025-1.375-1.687T7.5 4.65q-1.5 0-2.5 1t-1 2.5q0 .875.35 1.763t1.25 2.025t2.45 2.675T12 18.3m0-6.825" />
  </svg>
);

export const FavoriteFilledIcon: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 32 32"
    fill={fill}
    width={width}
    height={height}
  >
    <path d="M22.5 4c-2 0-3.9.8-5.3 2.2L16 7.4l-1.1-1.1c-2.9-3-7.7-3-10.6-.1l-.1.1c-3 3-3 7.8 0 10.8L16 29l11.8-11.9c3-3 3-7.8 0-10.8C26.4 4.8 24.5 4 22.5 4" />
  </svg>
);

export const FavoriteGenericIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    width={width}
    height={height}
  >
    <circle
      cx="12"
      cy="12"
      r="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeDasharray="4 3"
    />
  </svg>
);

export const FavoritePinIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    width={width}
    height={height}
  >
    <path d="M17 4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2.5L5.5 8 4 9.5V12h7v8l1 1 1-1v-8h7V9.5L18.5 8 17 6.5V4z" />
  </svg>
);

export const ChevronUpIcon: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill={fill}
    width={width}
    height={height}
  >
    <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
  </svg>
);

export const ChevronDownIcon: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill={fill}
    width={width}
    height={height}
  >
    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
  </svg>
);
