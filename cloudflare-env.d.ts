declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    LUNCH_PROVIDER?: string;
    LUNCH_DEFAULT_BAILIAN_KEY?: string;
    LUNCH_BASE_URL?: string;
    LUNCH_TEXT_MODEL?: string;
    LUNCH_EMBED_MODEL?: string;
    LUNCH_SPEECH_MODEL?: string;
    OPENAI_API_KEY?: string;
    DASHSCOPE_API_KEY?: string;
    DASHSCOPE_ASR_API_KEY?: string;
  }
}
