const token = process.env.HULY_API_KEY
if (!token) {
  console.error('HULY_API_KEY not set')
  process.exit(1)
}

try {
  const payload = token.split('.')[1]
  const decoded = Buffer.from(payload, 'base64').toString('utf8')
  console.log('Decoded JWT payload:')
  console.log(JSON.stringify(JSON.parse(decoded), null, 2))
} catch (err) {
  console.error('Error decoding token:', err)
}