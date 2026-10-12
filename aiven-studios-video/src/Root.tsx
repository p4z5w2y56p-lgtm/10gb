import "./fonts";
import { Composition } from "remotion";
import { AivenStudios } from "./studio/AivenStudios";
import { DURATION, FPS, HEIGHT, WIDTH } from "./timeline";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Company ad in the AIVEN STUDIOS brand system, Dutch copy */}
      <Composition id="AivenStudios" component={AivenStudios} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={WIDTH} height={HEIGHT} />
      {/* Same film, 9:16 for TikTok / Reels: every scene reads useStage() and lays itself out vertically */}
      <Composition id="AivenStudiosVertical" component={AivenStudios} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={1080} height={1920} />
    </>
  );
};
