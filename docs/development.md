# Development Guide

This guide will help you set up a development environment and contribute to BeepBite.

## Getting Started

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **Git** for version control
- **Code Editor** (VS Code recommended)
- **Terminal/Command Line**

### Development Setup

#### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/yourusername/beepbite-mono.git
cd beepbite-mono

# Add upstream remote
git remote add upstream https://github.com/original/beepbite-mono.git
```

#### 2. Install Dependencies

```bash
# Install all dependencies
npm install

# Or using yarn
yarn install
```

#### 3. Environment Setup

```bash
# Copy environment template
cp .env.example .env.local

# Configure your environment variables
# See setup.md for detailed configuration
```

#### 4. Start Development

```bash
# Start development server
npm run dev

# Server will start at http://localhost:5173
```

## Project Structure

```
beepbite-mono/
├── public/                 # Static assets
├── src/                    # Source code
│   ├── assets/            # Images, fonts, etc.
│   │   ├── auth/         # Authentication components
│   │   ├── layout/       # Layout components
│   │   ├── modals/       # Modal components
│   │   ├── nav/          # Navigation components
│   │   └── ui/           # UI components (shadcn/ui)
│   ├── context/          # React contexts
│   ├── hooks/            # Custom React hooks
│   ├── lib/              # Utility libraries
│   ├── pages/            # Page components
│   │   ├── auth/         # Authentication pages
│   │   ├── dashboard/    # Dashboard pages
│   │   ├── landing/      # Landing page
│   │   ├── reports/      # Reporting pages
│   │   └── reviews/      # Review management
│   ├── services/         # API services
│   ├── App.jsx           # Main app component
│   ├── main.jsx          # Entry point
│   └── routes.jsx        # Route definitions
├── docs/                 # Documentation
├── package.json          # Dependencies and scripts
└── README.md            # Project overview
```

## Development Workflow

### Branch Strategy

We use a simplified Git Flow:

- `main` - Production-ready code
- `develop` - Integration branch for features
- `feature/*` - Feature branches
- `hotfix/*` - Emergency fixes
- `release/*` - Release preparation

### Creating a Feature

```bash
# Create feature branch from develop
git checkout develop
git pull upstream develop
git checkout -b feature/your-feature-name

# Make your changes
# Commit frequently with clear messages

# Push to your fork
git push origin feature/your-feature-name

# Create pull request on GitHub
```

### Commit Message Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

**Examples:**
```
feat(orders): add real-time order status updates
fix(auth): resolve login redirect issue
docs(api): update authentication documentation
```

## Code Standards

### Style Guide

We use ESLint and Prettier for code formatting:

```bash
# Check linting
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Format code
npm run format
```

### Component Guidelines

#### React Components

```jsx
// Use functional components with hooks
import React, { useState, useEffect } from 'react';

const OrderCard = ({ order, onStatusUpdate }) => {
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Side effects here
  }, [order.id]);

  const handleStatusChange = async (newStatus) => {
    setIsLoading(true);
    try {
      await onStatusUpdate(order.id, newStatus);
    } catch (error) {
      console.error('Failed to update status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="order-card">
      {/* Component JSX */}
    </div>
  );
};

export default OrderCard;
```

#### File Naming

- **Components**: PascalCase (`OrderCard.jsx`)
- **Hooks**: camelCase with `use` prefix (`useOrderStatus.js`)
- **Utils**: camelCase (`formatDate.js`)
- **Constants**: UPPER_SNAKE_CASE (`API_ENDPOINTS.js`)

#### Component Structure

```jsx
// 1. Imports (grouped and sorted)
import React from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';

// 2. Component definition
const ComponentName = ({ prop1, prop2 }) => {
  // 3. State and hooks
  const [state, setState] = useState(null);

  // 4. Event handlers
  const handleClick = () => {
    // Handler logic
  };

  // 5. Effects
  useEffect(() => {
    // Effect logic
  }, []);

  // 6. Render
  return (
    <div>
      {/* JSX */}
    </div>
  );
};

// 7. Export
export default ComponentName;
```

### CSS/Styling

We use Tailwind CSS for styling:

```jsx
// Prefer utility classes
<div className="flex items-center justify-between p-4 bg-white rounded-lg shadow-md">
  <h3 className="text-lg font-semibold text-gray-900">Order #123</h3>
  <Badge className="bg-green-100 text-green-800">Ready</Badge>
</div>

// Use custom CSS sparingly
// If needed, add to index.css with meaningful class names
```

### State Management

#### Local State
Use `useState` for component-local state:

```jsx
const [orders, setOrders] = useState([]);
const [loading, setLoading] = useState(false);
```

#### Global State
Use React Context for shared state:

```jsx
// context/orders-context.jsx
const OrdersContext = createContext();

export const OrdersProvider = ({ children }) => {
  const [orders, setOrders] = useState([]);
  
  const addOrder = (order) => {
    setOrders(prev => [...prev, order]);
  };

  return (
    <OrdersContext.Provider value={{ orders, addOrder }}>
      {children}
    </OrdersContext.Provider>
  );
};

export const useOrders = () => {
  const context = useContext(OrdersContext);
  if (!context) {
    throw new Error('useOrders must be used within OrdersProvider');
  }
  return context;
};
```

## API Integration

### Service Layer

Create service functions for API calls:

```javascript
// services/orders.js
import { supabase } from '@/lib/supabase';

export const ordersService = {
  async getOrders(filters = {}) {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .match(filters);
    
    if (error) throw error;
    return data;
  },

  async updateOrderStatus(orderId, status) {
    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', orderId);
    
    if (error) throw error;
    return data;
  }
};
```

### Error Handling

Implement consistent error handling:

```jsx
import { toast } from 'sonner';

const useOrders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchOrders = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await ordersService.getOrders();
      setOrders(data);
    } catch (err) {
      setError(err.message);
      toast.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  return { orders, loading, error, fetchOrders };
};
```

## Testing

### Unit Tests

We use Vitest for unit testing:

```javascript
// tests/utils/formatDate.test.js
import { describe, it, expect } from 'vitest';
import { formatDate } from '@/lib/utils';

describe('formatDate', () => {
  it('formats date correctly', () => {
    const date = new Date('2024-01-15T14:30:00Z');
    expect(formatDate(date)).toBe('Jan 15, 2024');
  });
});
```

### Component Tests

```jsx
// tests/components/OrderCard.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import OrderCard from '@/components/OrderCard';

describe('OrderCard', () => {
  const mockOrder = {
    id: '123',
    status: 'pending',
    customer: { name: 'John Doe' }
  };

  it('renders order information', () => {
    render(<OrderCard order={mockOrder} />);
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('calls onStatusUpdate when status changes', () => {
    const onStatusUpdate = vi.fn();
    render(<OrderCard order={mockOrder} onStatusUpdate={onStatusUpdate} />);
    
    fireEvent.click(screen.getByText('Accept'));
    expect(onStatusUpdate).toHaveBeenCalledWith('123', 'confirmed');
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Building and Deployment

### Development Build

```bash
# Build for development
npm run build:dev

# Preview build locally
npm run preview
```

### Production Build

```bash
# Build for production
npm run build

# Analyze bundle size
npm run build:analyze
```

### Environment-Specific Builds

```bash
# Staging build
npm run build:staging

# Production build
npm run build:production
```

## Performance Optimization

### Code Splitting

Use dynamic imports for route-based splitting:

```jsx
// routes.jsx
const Dashboard = lazy(() => import('./pages/dashboard'));
const Reports = lazy(() => import('./pages/reports'));

// Wrap in Suspense
<Suspense fallback={<LoadingSpinner />}>
  <Routes>
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/reports" element={<Reports />} />
  </Routes>
</Suspense>
```

### Image Optimization

```jsx
// Use optimized images
<img 
  src="/images/logo.webp" 
  alt="BeepBite Logo"
  loading="lazy"
  width="120"
  height="40"
/>
```

### Bundle Optimization

```javascript
// vite.config.js
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu']
        }
      }
    }
  }
});
```

## Debugging

### Development Tools

1. **React Developer Tools**
2. **Browser DevTools**
3. **VS Code Extensions**:
   - ES7+ React/Redux/React-Native snippets
   - Tailwind CSS IntelliSense
   - Auto Rename Tag
   - Bracket Pair Colorizer

### Common Issues

#### 1. Environment Variables Not Loading

```bash
# Variables must start with VITE_
VITE_API_URL=http://localhost:3000

# Restart dev server after changes
npm run dev
```

#### 2. Module Resolution Issues

```javascript
// Use absolute imports with @ alias
import { Button } from '@/components/ui/button';

// Instead of relative imports
import { Button } from '../../../components/ui/button';
```

#### 3. Hot Reload Not Working

```bash
# Clear cache and restart
rm -rf node_modules/.vite
npm run dev
```

## Contributing Guidelines

### Pull Request Process

1. **Check existing issues** before starting work
2. **Create an issue** for new features or bugs
3. **Fork the repository** and create a feature branch
4. **Write tests** for new functionality
5. **Update documentation** as needed
6. **Submit pull request** with clear description

### PR Requirements

- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Documentation updated
- [ ] No breaking changes (or clearly marked)
- [ ] Related issue linked

### Code Review

All PRs require review from maintainers:

- **Focus areas**: Logic, performance, security, UX
- **Response time**: Usually within 48 hours
- **Approval criteria**: Code quality, test coverage, documentation

## Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Release Steps

1. **Create release branch**: `release/v1.2.0`
2. **Update version**: `package.json`
3. **Update CHANGELOG**: Document changes
4. **Test thoroughly**: All features and integrations
5. **Merge to main**: Create pull request
6. **Tag release**: `git tag v1.2.0`
7. **Deploy**: Automated via CI/CD

## Resources

### Learning Resources

- **React**: [react.dev](https://react.dev)
- **Tailwind CSS**: [tailwindcss.com](https://tailwindcss.com)
- **Supabase**: [supabase.com/docs](https://supabase.com/docs)
- **Vite**: [vitejs.dev](https://vitejs.dev)

### Tools and Extensions

- **VS Code Settings**: `.vscode/settings.json`
- **ESLint Config**: `eslint.config.js`
- **Prettier Config**: `.prettierrc`
- **Tailwind Config**: `tailwind.config.js`

### Community

- **GitHub Discussions**: Feature requests and questions
- **Discord**: Real-time chat and support
- **Email**: developers@beepbite.com

## Getting Help

1. **Check documentation** first
2. **Search existing issues** on GitHub
3. **Create new issue** with reproduction steps
4. **Join Discord** for community support
5. **Email support** for sensitive issues

---

Thank you for contributing to BeepBite! Your efforts help restaurants worldwide manage their operations more efficiently. 