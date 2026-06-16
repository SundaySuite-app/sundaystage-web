import { OperatorBoundary } from "./OperatorBoundary";

export default async function OperatorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OperatorBoundary id={id} />;
}
