import { isValidElement, type ReactElement, type ReactNode } from 'react';

export const requireReactElement = <Props>(
  value: ReactNode,
  message: string
): ReactElement<Props> => {
  if (!isValidElement<Props>(value)) {
    throw new Error(message);
  }
  return value;
};
