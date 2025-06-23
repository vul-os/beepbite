import React from 'react';

const LandingPage = () => {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <header className="py-4 px-6 border-b">
        <h1 className="text-2xl font-bold">BeepBite</h1>
      </header>
      <main className="flex-grow flex flex-col items-center justify-center text-center p-6">
        <h2 className="text-4xl md:text-5xl font-extrabold mb-4">
          Instant Order Notifications for Your Restaurant
        </h2>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-8">
          BeepBite sends real-time order alerts to your kitchen, so you never miss a beat. Simple, reliable, and fast.
        </p>
        <button className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-3 rounded-md text-lg font-semibold">
          Get Started for Free
        </button>
      </main>
      <section id="features" className="py-16 bg-muted">
        <div className="container mx-auto px-6 text-center">
          <h3 className="text-3xl font-bold mb-8">Why BeepBite?</h3>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-6 rounded-lg">
              <h4 className="text-xl font-semibold mb-2">Real-Time Alerts</h4>
              <p className="text-muted-foreground">
                Get instant notifications for new orders on any device.
              </p>
            </div>
            <div className="p-6 rounded-lg">
              <h4 className="text-xl font-semibold mb-2">Easy Setup</h4>
              <p className="text-muted-foreground">
                Integrate with your existing system in minutes. No complex hardware required.
              </p>
            </div>
            <div className="p-6 rounded-lg">
              <h4 className="text-xl font-semibold mb-2">Reliable & Robust</h4>
              <p className="text-muted-foreground">
                Our system is built to handle the rush of peak hours without fail.
              </p>
            </div>
          </div>
        </div>
      </section>
      <footer className="py-6 px-6 border-t text-center text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} BeepBite. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default LandingPage;
