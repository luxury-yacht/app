import React from 'react';

type IconProps = {
  width?: number;
  height?: number;
};

export const YamlManagedFieldsIcon: React.FC<IconProps> = ({ width = 16, height = 16 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox="0 0 16 16">
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M10.315 5.032a2.11 2.11 0 0 0 2.064-1.678h1.833a.425.425 0 0 0 .3-.723a.43.43 0 0 0-.3-.124h-1.83a2.11 2.11 0 0 0-4.136 0H1.79a.424.424 0 0 0 0 .847h6.46a2.11 2.11 0 0 0 2.066 1.678m0-.88a1.23 1.23 0 1 1 0-2.46a1.23 1.23 0 0 1 0 2.46m-4.404 5.977A2.11 2.11 0 0 0 7.98 8.443l6.233-.007a.425.425 0 0 0 .3-.722a.43.43 0 0 0-.3-.124l-6.233.006a2.11 2.11 0 0 0-4.133 0L1.79 7.59a.423.423 0 0 0 0 .846l2.057.007a2.11 2.11 0 0 0 2.066 1.686m0-.88a1.23 1.23 0 1 1 0-2.46a1.23 1.23 0 0 1 0 2.46m4.398 5.938a2.11 2.11 0 0 0 2.068-1.694l1.833.026a.425.425 0 0 0 .3-.723a.43.43 0 0 0-.3-.124l-1.836-.027a2.11 2.11 0 0 0-4.13 0l-6.457.027a.424.424 0 0 0 0 .847l6.454-.026a2.11 2.11 0 0 0 2.068 1.694m0-.88a1.23 1.23 0 1 1 0-2.46a1.23 1.23 0 0 1 0 2.46"
      clipRule="evenodd"
    />
  </svg>
);

export const YamlEditIcon: React.FC<IconProps> = ({ width = 18, height = 18 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox="0 0 24 24">
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="m5 16l-1 4l4-1L19.586 7.414a2 2 0 0 0 0-2.828l-.172-.172a2 2 0 0 0-2.828 0zM15 6l3 3m-5 11h8"
    />
  </svg>
);

export const YamlCancelIcon: React.FC<IconProps> = ({ width = 16, height = 16 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    width={width}
    height={height}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
  >
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const YamlSaveIcon: React.FC<IconProps> = ({ width = 20, height = 20 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox="0 0 24 24">
    <path
      fill="currentColor"
      d="M5 21h14c1.1 0 2-.9 2-2V8c0-.27-.11-.52-.29-.71l-4-4A1 1 0 0 0 16 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2m10-2H9v-5h6zM11 5h2v2h-2zM5 5h2v4h8V5h.59L19 8.41V19h-2v-5c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v5H5z"
    />
  </svg>
);

export const YamlPreviousIcon: React.FC<IconProps> = ({ width = 14, height = 14 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width={width} height={height}>
    <path fill="currentColor" d="m4 10l9 9l1.4-1.5L7 10l7.4-7.5L13 1z" />
  </svg>
);

export const YamlNextIcon: React.FC<IconProps> = ({ width = 14, height = 14 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width={width} height={height}>
    <path fill="currentColor" d="M7 1L5.6 2.5L13 10l-7.4 7.5L7 19l9-9z" />
  </svg>
);
