import { DisplayClient } from "./DisplayClient";

export default async function DisplayPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <DisplayClient code={code} />;
}
