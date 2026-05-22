/**
 * Discord server-widget embed.
 * Server: The Way of the Sith (1471072707524296767)
 * Renders online members + Join button. Theme: dark to match the brand.
 *
 * Note: requires the server's "Server Widget" toggle to be ON in
 * Server Settings → Widget → Enable Server Widget.
 */
export function DiscordWidget({
  guildId = "1471072707524296767",
  width = 350,
  height = 500,
}: {
  guildId?: string;
  width?: number | string;
  height?: number | string;
}) {
  return (
    <iframe
      title="Discord — The Way of the Sith"
      src={`https://discord.com/widget?id=${guildId}&theme=dark`}
      width={width}
      height={height}
      allowTransparency
      frameBorder="0"
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
      className="block w-full max-w-[350px] mx-auto"
    />
  );
}
