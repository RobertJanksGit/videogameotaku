# Video Game Otaku

A community-driven platform for video game enthusiasts to share news, reviews, guides, and opinions.

## Features

- User authentication and authorization
- Post creation and management
- Content moderation system
- Rate limiting and anti-spam protection
- Real-time updates
- Markdown support for posts
- Image upload capabilities
- Voting system
- Platform-specific content categorization
- Dark/Light mode support

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Firebase account
- Git

## Setup

1. Clone the repository:

```bash
git clone https://github.com/yourusername/videogameotaku.git
cd videogameotaku
```

2. Install dependencies:

```bash
npm install
# or
yarn install
```

3. Set up Firebase:

   - Create a new Firebase project at [Firebase Console](https://console.firebase.google.com)
   - Enable Authentication, Firestore, and Storage services
   - Copy your Firebase configuration

4. Configure environment variables:

   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Fill in your Firebase configuration values in `.env`

5. Set up Firebase configuration:

   - Copy `src/config/firebase.template.js` to `src/config/firebase.js`:
     ```bash
     cp src/config/firebase.template.js src/config/firebase.js
     ```

6. Deploy Firebase security rules:
   ```bash
   firebase deploy --only firestore:rules
   ```

## Development

Start the development server:

```bash
npm run dev
# or
yarn dev
```

## Content Moderation System

The platform includes a sophisticated content moderation system:

### Post Status

- **Pending**: New posts from regular users
- **Published**: Approved posts
- **Rejected**: Posts that violate guidelines

### Rate Limiting

- Users are limited to 50 posts per hour
- Cooldown periods:
  - 10 minutes between regular posts
  - 3 minutes after a rejected post
- Ban system:
  - 5 rejected posts result in a 24-hour ban
  - Rejections reset after 6 hours
  - Bans automatically expire

## Security

- Firebase Authentication for user management
- Secure Firebase Rules for data access control
- Environment variables for sensitive configuration
- Rate limiting to prevent abuse
- Image upload restrictions and validation

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
