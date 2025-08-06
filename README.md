# Order Tracker Backend

A simplified, focused backend for the Order Tracker application that fetches and parses order emails from Gmail.

## 🏗️ Architecture

```
backend/
├── src/
│   ├── config/
│   │   ├── database.js          # Database configuration
│   │   └── emailConfig.js       # Email filtering configuration
│   ├── middleware/
│   │   ├── auth.js              # JWT authentication
│   │   └── errorHandler.js      # Global error handling
│   ├── models/                  # Sequelize database models
│   ├── routes/
│   │   ├── auth.js              # Authentication routes
│   │   ├── orders.js            # Order management routes
│   │   └── sync.js              # Email sync routes
│   ├── services/
│   │   ├── gmailService.js      # Gmail API integration
│   │   ├── emailParser.js       # Email parsing logic
│   │   └── syncService.js       # Sync orchestration
│   ├── utils/
│   │   └── logger.js            # Logging utility
│   └── server.js                # Express server setup
├── package.json
└── README.md
```

## 🚀 Features

### Core Functionality

- **Gmail Integration**: Fetch order emails using Gmail API
- **Smart Filtering**: Exclude promotional emails and focus on order-related content
- **Multi-Platform Support**: Parse orders from Amazon, Flipkart, and Myntra
- **Configurable Settings**: Easy-to-modify email filtering rules
- **RESTful API**: Clean API endpoints for frontend integration

### Email Processing

- **Configurable Date Range**: Fetch emails from last N days (default: 7 days)
- **Platform-Specific Parsing**: Individual parsers for each e-commerce platform
- **Promotional Filtering**: Automatically exclude marketing and promotional emails
- **Order Detection**: Focus on order confirmation, shipping, and delivery emails

## 🔧 Configuration

### Email Filtering Settings (`src/config/emailConfig.js`)

```javascript
module.exports = {
  // Default number of days to fetch emails
  defaultDaysToFetch: 7,

  // Maximum number of emails to fetch per sync
  maxEmailsPerSync: 100,

  // Supported platforms
  supportedPlatforms: ["amazon", "flipkart", "myntra"],

  // Promotional keywords to exclude
  promotionalKeywords: ["newsletter", "deals", "offers", ...],

  // Order-related keywords to include
  orderKeywords: ["order", "order confirmation", "shipped", ...]
};
```

### Environment Variables

```bash
# Server
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_NAME=order_tracker_dev
DB_USER=postgres
DB_PASSWORD=password

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# JWT
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=7d
```

## 📡 API Endpoints

### Authentication

- `POST /auth/google` - Initiate Google OAuth
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/me` - Get current user

### Email Sync

- `POST /api/sync/trigger` - Start email sync
- `GET /api/sync/status` - Get sync status
- `GET /api/sync/history` - Get sync history

### Orders

- `GET /api/orders` - List orders (paginated)
- `GET /api/orders/:id` - Get order details
- `POST /api/orders/search` - Search orders

## 🔄 Sync Process

1. **Authentication**: Verify user has valid Gmail access tokens
2. **Email Fetching**: Search Gmail for order-related emails from specified platforms
3. **Filtering**: Exclude promotional emails using configurable rules
4. **Parsing**: Parse emails using platform-specific parsers
5. **Data Extraction**: Extract order details (ID, amount, items, status)
6. **Response**: Return structured JSON with parsed orders

### Sync Request Example

```javascript
POST /api/sync/trigger
{
  "daysToFetch": 7,
  "maxResults": 100,
  "platforms": ["amazon", "flipkart", "myntra"]
}
```

### Sync Response Example

```javascript
{
  "success": true,
  "message": "Email sync started successfully",
  "data": {
    "syncId": "sync_user123_1234567890",
    "estimatedDuration": "2-5 minutes",
    "options": {
      "daysToFetch": 7,
      "maxResults": 100,
      "platforms": ["amazon", "flipkart", "myntra"]
    }
  }
}
```

## 🧩 Services

### GmailService

Handles Gmail API interactions:

- Initialize OAuth client
- Search for order emails
- Fetch email details
- Filter promotional content

### EmailParser

Platform-specific email parsing:

- **AmazonEmailParser**: Parse Amazon order emails
- **FlipkartEmailParser**: Parse Flipkart order emails
- **MyntraEmailParser**: Parse Myntra order emails
- **EmailParserFactory**: Route emails to appropriate parser

### SyncService

Orchestrates the sync process:

- Manage sync status
- Coordinate email fetching and parsing
- Handle errors and retries
- Provide sync progress updates

## 🛠️ Development

### Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Start development server
npm run dev
```

### Database Setup

```bash
# Run migrations
npm run db:migrate

# Seed database (if needed)
npm run db:seed
```

### Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch
```

## 📊 Monitoring

### Logging

- Winston logger with structured logging
- Different log levels (error, warn, info, debug)
- Request/response logging with Morgan

### Health Checks

- `GET /health` - Application health status
- Database connection monitoring
- Gmail API connectivity checks

## 🔒 Security

- **Authentication**: Google OAuth 2.0 with JWT tokens
- **Rate Limiting**: Express rate limiting for API endpoints
- **CORS**: Configured for frontend domain
- **Helmet**: Security headers
- **Input Validation**: Request validation middleware

## 🚀 Deployment

### Production Setup

```bash
# Build and start
npm start

# Environment variables for production
NODE_ENV=production
DB_SSL=true
```

### Docker Deployment

```bash
# Build image
docker build -t order-tracker-backend .

# Run container
docker run -p 3000:3000 order-tracker-backend
```

## 📈 Performance

### Optimizations

- Batch email fetching (20 emails per batch)
- Configurable result limits
- Efficient Gmail search queries
- Parallel processing where possible

### Monitoring

- Sync duration tracking
- Email parsing success rates
- API response times
- Error rate monitoring

## 🔧 Customization

### Adding New Platforms

1. Create new parser in `src/services/emailParser.js`
2. Add platform configuration in `src/config/emailConfig.js`
3. Update Gmail search queries in `src/services/gmailService.js`

### Modifying Email Filters

Edit `src/config/emailConfig.js` to:

- Add/remove promotional keywords
- Modify supported platforms
- Adjust search parameters

## 🆘 Troubleshooting

### Common Issues

- **Gmail API Errors**: Check OAuth tokens and permissions
- **Database Connection**: Verify database credentials and connectivity
- **Parsing Failures**: Review email structure and parser logic

### Debug Mode

```bash
# Enable debug logging
DEBUG=* npm run dev
```

---

**Happy Tracking! 📦✨**
