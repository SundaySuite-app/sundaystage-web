import { SceneClient } from "./SceneClient";

export default async function ScenePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <SceneClient code={code} />;
}
