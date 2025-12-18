import React from 'react';
import { useDetailsSectionContext } from '@contexts/DetailsSectionContext';
import '../shared.css';
import './DetailsTabContainers.css';

interface Container {
  name: string;
  image: string;
  ready?: boolean;
  restartCount?: number;
  state?: string;
}

interface ContainersProps {
  containers?: Container[];
  initContainers?: Container[];
}

function Containers({ containers = [], initContainers = [] }: ContainersProps) {
  const { sectionStates, setSectionExpanded } = useDetailsSectionContext();
  const expanded = sectionStates.containers;

  // Helper function to split image into name and tag
  const parseImage = (image: string) => {
    const lastColonIndex = image.lastIndexOf(':');
    const lastSlashIndex = image.lastIndexOf('/');

    // Check if colon exists and comes after the last slash (to avoid registry port numbers)
    if (lastColonIndex > lastSlashIndex && lastColonIndex !== -1) {
      return {
        name: image.substring(0, lastColonIndex),
        tag: image.substring(lastColonIndex + 1),
      };
    }

    // No tag specified, default to latest
    return {
      name: image,
      tag: 'latest',
    };
  };

  // Combine all containers with their type
  const allContainers = [
    ...initContainers.map((c) => ({ ...c, type: 'Init' })),
    ...containers.map((c) => ({ ...c, type: 'Standard' })),
  ];

  if (allContainers.length === 0) {
    return null;
  }

  return (
    <div className="object-panel-section">
      <div
        className={`object-panel-section-title collapsible${!expanded ? ' collapsed' : ''}`}
        onClick={() => setSectionExpanded('containers', !expanded)}
      >
        <span className="collapse-icon">{expanded ? '▼' : '▶'}</span>
        Containers
      </div>
      {expanded && (
        <div className="object-panel-section-grid">
          {allContainers.map((container, index) => (
            <React.Fragment key={`${container.type}-${container.name}-${index}`}>
              <div className="containers-item">
                <span className="containers-label">Type</span>
                <span className="containers-value">{container.type}</span>
              </div>

              <div className="containers-item">
                <span className="containers-label">Name</span>
                <span className="containers-value">{container.name}</span>
              </div>

              <div className="containers-item containers-item-full">
                <span className="containers-label">Image Name</span>
                <span className="containers-value" title={container.image}>
                  {parseImage(container.image).name}
                </span>
              </div>

              <div className="containers-item containers-item-full">
                <span className="containers-label">Image Tag</span>
                <span className="containers-value containers-tag">
                  {parseImage(container.image).tag}
                </span>
              </div>

              {index < allContainers.length - 1 && (
                <div
                  className="containers-item containers-item-full"
                  style={{
                    borderBottom: '1px solid var(--border-color)',
                    paddingBottom: '0.5rem',
                    marginBottom: '0.5rem',
                  }}
                ></div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

export default Containers;
