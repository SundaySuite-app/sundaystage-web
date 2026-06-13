import { FollowClient } from "./FollowClient";

export default async function FollowPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <FollowClient code={code} />;
}
