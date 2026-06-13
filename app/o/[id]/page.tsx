import { OperatorClient } from "./OperatorClient";

export default async function OperatorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OperatorClient id={id} />;
}
