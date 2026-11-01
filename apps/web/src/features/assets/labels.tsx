import { ASSET_CONDITION_LABEL, ASSET_STATUS_LABEL } from '@sima/shared';
import { Badge } from '@/components/ui/misc';

const conditionTone = { GOOD: 'success', MINOR_DAMAGE: 'warning', MAJOR_DAMAGE: 'danger' } as const;
const statusTone = { AVAILABLE: 'success', LOANED: 'info', UNDER_MAINTENANCE: 'warning', MISSING: 'danger', DISPOSED: 'neutral' } as const;

export const ConditionBadge = ({ value }: { value: keyof typeof ASSET_CONDITION_LABEL }) => <Badge tone={conditionTone[value]}>{ASSET_CONDITION_LABEL[value]}</Badge>;
export const StatusBadge = ({ value }: { value: keyof typeof ASSET_STATUS_LABEL }) => <Badge tone={statusTone[value]}>{ASSET_STATUS_LABEL[value]}</Badge>;
