import "./fonts";
import { Composition } from "remotion";
import { AivenStudios } from "./studio/AivenStudios";
import { DURATION, FPS, HEIGHT, WIDTH } from "./timeline";
import { AivenVideoV3, TOTAL_BEATS } from "./v3/AivenVideoV3";
import { b } from "./v3/brand";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Company ad in the AIVEN STUDIOS brand system, Dutch copy */}
      <Composition id="AivenStudios" component={AivenStudios} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={WIDTH} height={HEIGHT} />
      {/* Same film, 9:16 for TikTok / Reels: every scene reads useStage() and lays itself out vertically */}
      <Composition id="AivenStudiosVertical" component={AivenStudios} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={1080} height={1920} />
      {/* v3: own take on the reference grammar (neural sphere, noise-to-grid, iso web, terrain, launch arrow), cut to the track */}
      <Composition id="AivenStudiosV3" component={AivenVideoV3} durationInFrames={b(TOTAL_BEATS)} fps={60} width={1920} height={1080} />
    </>
  );
};
