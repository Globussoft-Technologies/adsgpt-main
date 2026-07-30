import { Navigate } from 'react-router-dom';
import {
  allowedWorkspaceFeatures,
  canUseWorkspaceFeature,
  firstAllowedPath,
  isWorkspaceMember,
} from '@/utils/workspaceSession';

export default function WorkspaceFeatureRoute({ feature, anyOf, ownerOnly = false, children }) {
  if (ownerOnly && isWorkspaceMember()) {
    return <Navigate to={firstAllowedPath(allowedWorkspaceFeatures())} replace />;
  }
  const permitted = anyOf
    ? anyOf.some((featureId) => canUseWorkspaceFeature(featureId))
    : canUseWorkspaceFeature(feature);
  if (permitted) return children;
  return <Navigate to={firstAllowedPath(allowedWorkspaceFeatures())} replace />;
}
