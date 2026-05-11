import React from 'react';
import type { IconProps } from './SharedIcons';

export const KubeconfigsIcon: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  fill = 'currentColor',
}) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    width={width}
    height={height}
  >
    <path
      d="M2.687 3.21l5.062 4.117c-.477.099-.837.53-.837 1.045 0 .133.024.26.067.377L1.706 4.462a.81.81 0 01-.124-1.126.776.776 0 011.105-.126z"
      fill={fill}
    />
    <path
      d="M7.482 9.322L1.06 10.808a.786.786 0 01-.94-.603.801.801 0 01.592-.958L7.095 7.77a1.076 1.076 0 00-.183.602c0 .414.232.773.57.95z"
      fill={fill}
    />
    <path
      d="M8.429 9.327l-2.905 6.12a.78.78 0 01-1.05.373.807.807 0 01-.365-1.07l2.86-6.028c.143.418.533.718.991.718.169 0 .328-.04.469-.113z"
      fill={fill}
    />
    <path
      d="M8.97 8.66l2.89 6.09a.807.807 0 01-.365 1.07.78.78 0 01-1.05-.372l-2.89-6.091c.124.053.261.083.405.083.481 0 .886-.33 1.01-.78z"
      fill={fill}
    />
    <path
      d="M8.462 9.31a1.07 1.07 0 00.546-.938c0-.233-.073-.448-.198-.624l6.478 1.499a.8.8 0 01.592.958.786.786 0 01-.94.603L8.462 9.31zM8.746.9v6.766a1.037 1.037 0 00-1.572 0V.901c0-.443.352-.801.786-.801.434 0 .786.358.786.8z"
      fill={fill}
    />
    <path
      d="M13.234 3.21a.776.776 0 011.104.126.81.81 0 01-.123 1.126L8.94 8.749c.043-.117.067-.244.067-.377 0-.516-.36-.946-.837-1.045l5.063-4.117z"
      fill={fill}
    />
    <path
      d="M7.96 3.302c-2.75 0-4.978 2.27-4.978 5.07 0 2.8 2.229 5.07 4.978 5.07 2.75 0 4.978-2.27 4.978-5.07 0-2.8-2.229-5.07-4.978-5.07zm-6.55 5.07c0-3.684 2.933-6.67 6.55-6.67 3.618 0 6.55 2.986 6.55 6.67 0 3.685-2.932 6.671-6.55 6.671-3.617 0-6.55-2.986-6.55-6.67z"
      fill={fill}
    />
  </svg>
);

export const DisplayIcon: React.FC<IconProps> = ({
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
    <path d="M13 18V20H17V22H7V20H11V18H3.00094C2.4485 18 2 17.5551 2 17.0066V3.9934C2 3.44476 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44495 22 3.9934V17.0066C22 17.5552 21.5447 18 21.0091 18H13ZM4 5V16H20V5H4Z" />
  </svg>
);

export const AdvancedIcon: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    width={width}
    height={height}
  >
    <path
      d="M18 4C18 3.44772 17.5523 3 17 3C16.4477 3 16 3.44772 16 4V5H4C3.44772 5 3 5.44772 3 6C3 6.55228 3.44772 7 4 7H16V8C16 8.55228 16.4477 9 17 9C17.5523 9 18 8.55228 18 8V7H20C20.5523 7 21 6.55228 21 6C21 5.44772 20.5523 5 20 5H18V4ZM4 11C3.44772 11 3 11.4477 3 12C3 12.5523 3.44772 13 4 13H6V14C6 14.5523 6.44772 15 7 15C7.55228 15 8 14.5523 8 14V13H20C20.5523 13 21 12.5523 21 12C21 11.4477 20.5523 11 20 11H8V10C8 9.44772 7.55228 9 7 9C6.44772 9 6 9.44772 6 10V11H4ZM3 18C3 17.4477 3.44772 17 4 17H16V16C16 15.4477 16.4477 15 17 15C17.5523 15 18 15.4477 18 16V17H20C20.5523 17 21 17.4477 21 18C21 18.5523 20.5523 19 20 19H18V20C18 20.5523 17.5523 21 17 21C16.4477 21 16 20.5523 16 20V19H4C3.44772 19 3 18.5523 3 18Z"
      fill={fill}
    />
  </svg>
);

export const AppearanceModeIcon: React.FC<IconProps> = ({
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
    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10m0-2V4a8 8 0 1 1 0 16" />
  </svg>
);

export const KubeconfigFolderIcon: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  className,
}) => (
  <svg viewBox="0 0 16 16" width={width} height={height} fill="none" className={className}>
    <path
      d="M1.75 3.5h4.19c.27 0 .53.1.72.3l1.27 1.27c.19.19.45.3.72.3h5.6c.55 0 1 .45 1 1v6.88c0 .55-.45 1-1 1H1.75c-.55 0-1-.45-1-1V4.5c0-.55.45-1 1-1Z"
      stroke="currentColor"
      strokeWidth="1.25"
    />
  </svg>
);
