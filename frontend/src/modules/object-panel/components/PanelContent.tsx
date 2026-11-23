import type { ComponentProps } from 'react';
import { ApiResourcePanel } from '../apiResource/ApiResourcePanel';
import { IdentityPanel } from '../identity/IdentityPanel';
import { isApiResourcePanelRef, isIdentityPanelRef, type PanelTarget } from '../panelTarget';
import ObjectPanel from './ObjectPanel/ObjectPanel';

type Props = Omit<ComponentProps<typeof ObjectPanel>, 'objectRef'> & { objectRef: PanelTarget };

export default function PanelContent({ objectRef, ...props }: Readonly<Props>) {
  if (isIdentityPanelRef(objectRef)) {
    return <IdentityPanel {...props} identity={objectRef} />;
  }
  if (isApiResourcePanelRef(objectRef)) {
    return <ApiResourcePanel {...props} kind={objectRef} />;
  }
  return <ObjectPanel {...props} objectRef={objectRef} />;
}
