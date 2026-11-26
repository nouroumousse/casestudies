export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ configured: Boolean(process.env.OPENAI_API_KEY) });
}