import type { ComponentProps } from 'react';
import { IdentityPanel } from '../identity/IdentityPanel';
import { isIdentityPanelRef, type PanelTarget } from '../panelTarget';
import ObjectPanel from './ObjectPanel/ObjectPanel';

type Props = Omit<ComponentProps<typeof ObjectPanel>, 'objectRef'> & { objectRef: PanelTarget };

export default function PanelContent({ objectRef, ...props }: Readonly<Props>) {
  return isIdentityPanelRef(objectRef) ? (
    <IdentityPanel {...props} identity={objectRef} />
  ) : (
    <ObjectPanel {...props} objectRef={objectRef} />
  );
}
