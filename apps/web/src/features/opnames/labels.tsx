import { OPNAME_RESULT_LABEL, OPNAME_STATUS_LABEL } from '@sima/shared';
import { Badge } from '@/components/ui/misc';

const tone = { MATCH: 'success', MISMATCH: 'warning', NOT_FOUND: 'danger', NOT_CHECKED: 'neutral', UNREGISTERED: 'info' } as const;
export const ResultBadge = ({ value }: { value: keyof typeof OPNAME_RESULT_LABEL }) => <Badge tone={tone[value]}>{OPNAME_RESULT_LABEL[value]}</Badge>;
export { OPNAME_STATUS_LABEL };
