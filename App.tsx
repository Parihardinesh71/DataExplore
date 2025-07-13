import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Customer, CustomerInfo, ParsedTransaction, Transaction, StoreInfo, ShareContext, TransactionDetail, ManualTransactionPayload, MemoPayload } from './types';
import { parseTransaction, parseHubCommand } from './services/geminiService';
import AddCustomerForm from './components/SetupForm';
import BalanceCard from './components/BalanceCard';
import TransactionList from './components/TransactionList';
import MicButton from './components/MicButton';
import SharePage from './components/WhatsappNotification';
import { UserSwitchIcon, HeartIcon } from './components/icons';
import CustomerSelector from './components/CustomerSelector';
import ManualInput from './components/ManualInput';
import MemoPage from './components/MemoPage';
import StoreAccountsPage from './components/StoreAccountsPage';

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<'welcome' | 'hub' | 'ledger' | 'share' | 'memo' | 'accounts'>('welcome');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [activeTransactionId, setActiveTransactionId] = useState<string | null>(null);
  const [nextMemoNumber, setNextMemoNumber] = useState<number>(0);
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [addCustomerInitialData, setAddCustomerInitialData] = useState<Partial<CustomerInfo> | null>(null);
  const [hubSearchTerm, setHubSearchTerm] = useState('');
  
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [assistantMessage, setAssistantMessage] = useState('');
  const [shareContext, setShareContext] = useState<ShareContext | null>(null);

  const [recognition, setRecognition] = useState<any | null>(null);

  const storeInfo: StoreInfo = { name: "Deepak Kirana Store", phone: "+91 12345 67890" };

  // Load customers from localStorage on initial render
  useEffect(() => {
    try {
      const storedCustomers = localStorage.getItem('grocery-ledger-customers');
      if (storedCustomers) {
        const parsed = JSON.parse(storedCustomers).map((c: Customer) => ({
          ...c,
          transactions: c.transactions.map((t: any) => ({...t, timestamp: new Date(t.timestamp)}))
        })) as Customer[];
        setCustomers(parsed);
        
        const storedMemoCounter = localStorage.getItem('grocery-ledger-memo-counter');
        if (storedMemoCounter) {
            setNextMemoNumber(parseInt(storedMemoCounter, 10));
        } else {
            // Fallback for old data: find the max existing memo number
            const allTransactions = parsed.flatMap(c => c.transactions);
            const maxMemo = Math.max(-1, ...allTransactions.map(t => t.memoNumber).filter((n): n is number => n !== undefined && n !== null));
            setNextMemoNumber(maxMemo + 1);
        }
      }
    } catch (error) {
        console.error("Failed to load customers from local storage", error);
        setCustomers([]);
    }
  }, []);

  // Save customers to localStorage whenever they change
  useEffect(() => {
    try {
        localStorage.setItem('grocery-ledger-customers', JSON.stringify(customers));
        if (typeof nextMemoNumber === 'number' && !isNaN(nextMemoNumber)) {
            localStorage.setItem('grocery-ledger-memo-counter', nextMemoNumber.toString());
        }
    } catch (error) {
        console.error("Failed to save data to local storage", error);
        alert("Could not save data. Your browser's storage might be full.");
    }
  }, [customers, nextMemoNumber]);
  
  const selectedCustomer = useMemo(
    () => customers.find(c => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );
  
  const activeTransaction = useMemo(
    () => selectedCustomer?.transactions.find(t => t.id === activeTransactionId) || null,
    [selectedCustomer, activeTransactionId]
  );

  const speak = useCallback((text: string) => {
    try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-IN';
        window.speechSynthesis.speak(utterance);
        setAssistantMessage(text);
    } catch(e) {
        console.error("Speech synthesis failed", e);
        setAssistantMessage(text);
    }
  }, []);
  
  const updateCustomerData = (customerId: string, updateFn: (customer: Customer) => Customer) => {
    setCustomers(prevCustomers => prevCustomers.map(c => c.id === customerId ? updateFn(c) : c));
  };

  const handleSelectCustomer = useCallback((id: string) => {
    setSelectedCustomerId(id);
    setAssistantMessage('');
    setTranscript('');
    setShareContext(null);
    setHubSearchTerm(''); // Clear hub search term
    setCurrentPage('ledger');
  }, []);

  const handleAddNewCustomerRequest = useCallback((initialData?: Partial<CustomerInfo>) => {
    setAddCustomerInitialData(initialData || null);
    setIsAddingCustomer(true);
  }, []);

  const processHubVoiceCommand = useCallback(async (text: string) => {
    setIsProcessing(true);
    setTranscript(text);
    speak("Just a moment...");

    const command = await parseHubCommand(text);

    if (command.intent === 'search' || command.intent === 'select') {
        if (command.searchText) {
            setHubSearchTerm(command.searchText);
            const lowerSearchText = command.searchText.toLowerCase();
            const matches = customers.filter(c =>
                c.name.toLowerCase().includes(lowerSearchText) ||
                (c.phone && c.phone.includes(lowerSearchText))
            );

            if (matches.length === 1) {
                const selected = matches[0];
                handleSelectCustomer(selected.id);
                speak(`Opening ledger for ${selected.name}.`);
            } else if (matches.length > 1) {
                speak(`I found multiple customers matching ${command.searchText}. Please select one from the list.`);
            } else {
                speak(`No customer found for "${command.searchText}". You can say "add new customer".`);
            }
        } else {
             speak("I didn't catch a name or number to search for. Please try again.");
        }
    } else if (command.intent === 'add') {
        const initialData: Partial<CustomerInfo> = {};
        if (command.customerName) initialData.name = command.customerName;
        if (command.customerPhone) initialData.phone = command.customerPhone;
        
        handleAddNewCustomerRequest(initialData);
        speak(`Please confirm the details for the new customer.`);
    } else {
        speak("Sorry, I didn't understand that. You can say a name, or 'Add new customer'.");
    }

    setIsProcessing(false);
    setTimeout(() => setTranscript(''), 4000);
  }, [customers, speak, handleSelectCustomer, handleAddNewCustomerRequest]);

  const processVoiceCommand = useCallback(async (text: string) => {
    if (!selectedCustomerId) return;
    setIsProcessing(true);
    setTranscript(text);
    speak("Processing...");

    const parsedTransactions = await parseTransaction(text);

    if (parsedTransactions.length === 0) {
      speak("Sorry, I couldn't find any transactions. Please try again.");
      setShareContext(null); // Clear context if nothing was parsed
      setIsProcessing(false);
      return;
    }
    
    // Check if it's a payment transaction to create a share context
    const totalCreditAmount = parsedTransactions
      .filter(tx => tx.type === 'credit')
      .reduce((sum, tx) => sum + tx.amount, 0);
    
    const hasOnlyCredits = totalCreditAmount > 0 && parsedTransactions.every(tx => tx.type === 'credit');

    if (hasOnlyCredits) {
      updateCustomerData(selectedCustomerId, (customer) => {
        const previousBalance = customer.balance;
        const newBalance = previousBalance - totalCreditAmount;
        setShareContext({ previousBalance, amountPaid: totalCreditAmount, newBalance });

        let memoCounter = nextMemoNumber;
        const newTransactions: Transaction[] = parsedTransactions.map(tx => ({
            ...tx,
            id: `tx_${Date.now()}_${Math.random()}`,
            timestamp: new Date(),
            memoNumber: memoCounter++,
        }));
        setNextMemoNumber(memoCounter);

        speak(`OK. Payment of ${totalCreditAmount} Rupees received. The new balance is ${newBalance.toFixed(2)} Rupees.`);
        return {
          ...customer,
          balance: newBalance,
          transactions: [...newTransactions, ...customer.transactions]
        };
      });
    } else {
      // It's a debit or mixed transaction, so no specific payment summary.
      setShareContext(null);
      updateCustomerData(selectedCustomerId, (customer) => {
        let newBalance = customer.balance;
        let memoCounter = nextMemoNumber;
        const newTransactions: Transaction[] = parsedTransactions.map((tx: ParsedTransaction) => {
            if (tx.type === 'debit') {
              newBalance += tx.amount;
            } else { // Handle stray credits in mixed transactions
              newBalance -= tx.amount;
            }
            return {
                id: `tx_${Date.now()}_${Math.random()}`,
                item: tx.item,
                amount: tx.amount,
                type: tx.type,
                timestamp: new Date(),
                details: tx.details || [],
                memoNumber: memoCounter++,
            };
        });
        setNextMemoNumber(memoCounter);
        
        speak(`OK. Updated. The new balance is ${newBalance.toFixed(2)} Rupees.`);
        return {
            ...customer,
            balance: newBalance,
            transactions: [...newTransactions, ...customer.transactions]
        };
      });
    }
    
    setIsProcessing(false);

  }, [selectedCustomerId, speak, nextMemoNumber]);

  const handleManualTransaction = useCallback((data: ManualTransactionPayload) => {
    if (!selectedCustomerId) return;
    setShareContext(null); // Clear context as a new transaction is being added

    updateCustomerData(selectedCustomerId, (customer) => {
        const newBalance = customer.balance + (data.type === 'debit' ? data.amount : -data.amount);
        
        const newTransaction: Transaction = {
            id: `tx_${Date.now()}_${Math.random()}`,
            item: data.item,
            amount: data.amount,
            type: data.type,
            timestamp: new Date(),
            details: [],
            memoNumber: nextMemoNumber,
        };

        setNextMemoNumber(prev => prev + 1);

        const actionText = data.type === 'debit' ? 'Purchase' : 'Payment';
        speak(`OK. ${actionText} of ${data.amount} Rupees added. The new balance is ${newBalance.toFixed(2)} Rupees.`);

        return {
            ...customer,
            balance: newBalance,
            transactions: [newTransaction, ...customer.transactions],
        };
    });
  }, [selectedCustomerId, speak, nextMemoNumber]);

    const handleSaveMemo = useCallback((payload: MemoPayload) => {
        const { customerName, items, totalAmount } = payload;
        
        let customer = customers.find(c => c.name.toLowerCase() === customerName.toLowerCase());
        let customerId: string;

        if (customer) {
            customerId = customer.id;
            updateCustomerData(customerId, (c) => {
                const newBalance = c.balance + totalAmount;
                const newTransaction: Transaction = {
                    id: `tx_${Date.now()}_${Math.random()}`,
                    item: `Memo No. ${nextMemoNumber}`,
                    amount: totalAmount,
                    type: 'debit',
                    timestamp: new Date(),
                    details: items,
                    memoNumber: nextMemoNumber
                };
                setNextMemoNumber(prev => prev + 1);
                
                return {
                    ...c,
                    balance: newBalance,
                    transactions: [newTransaction, ...c.transactions]
                };
            });
            
        } else {
            const newTransaction: Transaction = {
                id: `tx_${Date.now()}_${Math.random()}`,
                item: `Memo No. ${nextMemoNumber}`,
                amount: totalAmount,
                type: 'debit',
                timestamp: new Date(),
                details: items,
                memoNumber: nextMemoNumber
            };
            const newCustomer: Customer = {
                id: `cust_${Date.now()}`,
                name: customerName,
                phone: '',
                isMonthlyPayer: false,
                balance: totalAmount,
                transactions: [newTransaction],
                isFavourite: false,
            };
            setCustomers(prev => [...prev, newCustomer]);
            setNextMemoNumber(prev => prev + 1);
            customerId = newCustomer.id;
        }
        
        handleSelectCustomer(customerId);
        speak(`Memo saved for ${customerName}. The customer's ledger is now open.`);

    }, [customers, nextMemoNumber, handleSelectCustomer, speak]);

  const handleUpdateTransaction = useCallback((txId: string, updatedData: { item: string; amount: number; details: TransactionDetail[], paymentSource: string }) => {
    if (!selectedCustomerId) return;
    setShareContext(null); // Editing invalidates payment summary
    
    updateCustomerData(selectedCustomerId, (customer) => {
        let originalTx: Transaction | undefined;
        const newTransactions = customer.transactions.map(tx => {
            if (tx.id === txId) {
                originalTx = { ...tx };
                return { ...tx, ...updatedData, timestamp: new Date() };
            }
            return tx;
        });

        if (!originalTx) return customer;

        let balanceAfterRevert = customer.balance;
        balanceAfterRevert += originalTx.type === 'debit' ? -originalTx.amount : originalTx.amount;
        
        const finalBalance = balanceAfterRevert + (originalTx.type === 'debit' ? updatedData.amount : -updatedData.amount);

        return { ...customer, transactions: newTransactions.sort((a,b) => b.timestamp.getTime() - a.timestamp.getTime()), balance: finalBalance };
    });

  }, [selectedCustomerId]);

  const handleDeleteTransaction = useCallback((txId: string) => {
    if (!selectedCustomerId) return;
    setShareContext(null); // Deleting invalidates payment summary
      
    updateCustomerData(selectedCustomerId, (customer) => {
      const txToDelete = customer.transactions.find(tx => tx.id === txId);
      if (!txToDelete) return customer;

      const newBalance = customer.balance + (txToDelete.type === 'debit' ? -txToDelete.amount : txToDelete.amount);
      const newTransactions = customer.transactions.filter(tx => tx.id !== txId);
      
      return { ...customer, transactions: newTransactions, balance: newBalance };
    });
  }, [selectedCustomerId]);


  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setAssistantMessage("Sorry, your browser doesn't support speech recognition.");
      return;
    }
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.onstart = () => setIsListening(true);
    rec.onend = () => {
        setIsListening(false);
    };
    rec.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
    };
    rec.onresult = (event: any) => {
      const spokenText = event.results[0][0].transcript;
      if (currentPage === 'ledger') {
        processVoiceCommand(spokenText);
      } else if (currentPage === 'hub') {
        processHubVoiceCommand(spokenText);
      }
    };
    setRecognition(rec);
  }, [processVoiceCommand, processHubVoiceCommand, currentPage]);
  
  const handleMicClick = () => {
    if (isListening || !recognition) {
      recognition?.stop();
    } else {
      setTranscript('');
      setAssistantMessage('Speak now...');
      recognition.start();
    }
  };
  
  const handleAddCustomer = (data: CustomerInfo) => {
    const newCustomer: Customer = {
        id: `cust_${Date.now()}`,
        name: data.name,
        phone: data.phone,
        isMonthlyPayer: data.isMonthlyPayer || false,
        balance: 0,
        transactions: [],
        isFavourite: false,
    };
    setCustomers(prev => [...prev, newCustomer]);
    setSelectedCustomerId(newCustomer.id);
    setIsAddingCustomer(false);
    setAddCustomerInitialData(null); // Clear initial data
    setCurrentPage('ledger');
    speak(`Hello ${data.name}, account ready. Current balance is zero Rupees.`);
  };

  const handleToggleFavourite = (customerId: string) => {
    updateCustomerData(customerId, (customer) => ({
      ...customer,
      isFavourite: !customer.isFavourite,
    }));
  };

  const handleSwitchCustomer = () => {
    setSelectedCustomerId(null);
    setShareContext(null);
    setHubSearchTerm('');
    setTranscript('');
    setAssistantMessage('');
    setCurrentPage('hub');
  };

  const handleGoToMemo = (customerId: string, transactionId: string) => {
    setSelectedCustomerId(customerId);
    setActiveTransactionId(transactionId);
    setCurrentPage('memo');
  };

  const handleEditTransaction = (transactionId: string) => {
    setActiveTransactionId(transactionId);
    setCurrentPage('memo');
  };

  const handleDeleteCustomer = (customerId: string) => {
    setCustomers(prev => prev.filter(c => c.id !== customerId));
    if (selectedCustomerId === customerId) {
        setSelectedCustomerId(null);
        setCurrentPage('hub');
    }
  };
  
  const handleShowAccounts = () => {
    setCurrentPage('accounts');
  };

  const handleExportData = () => {
    try {
      const dataToExport = {
        customers,
        nextMemoNumber,
      };
      const jsonString = JSON.stringify(dataToExport, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const date = new Date().toISOString().split('T')[0];
      link.download = `grocery-ledger-backup-${date}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      alert("Data has been exported successfully.");
    } catch (error) {
      console.error("Failed to export data", error);
      alert("Sorry, there was an error exporting your data.");
    }
  };

  const handleImportData = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!window.confirm("Are you sure you want to import data? This will overwrite all current customer and transaction records.")) {
          event.target.value = ''; // Reset file input
          return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
          try {
              const text = e.target?.result;
              if (typeof text !== 'string') {
                  throw new Error("File could not be read.");
              }
              const data = JSON.parse(text);

              if (data && Array.isArray(data.customers) && typeof data.nextMemoNumber === 'number') {
                  const parsedCustomers: Customer[] = data.customers.map((c: any) => ({
                      ...c,
                      transactions: c.transactions.map((t: any) => ({...t, timestamp: new Date(t.timestamp)}))
                  }));
                  
                  setCustomers(parsedCustomers);
                  setNextMemoNumber(data.nextMemoNumber);
                  alert("Data imported successfully. Your records have been updated.");
                  setCurrentPage('hub'); // Go back to hub to see the new data
              } else {
                  throw new Error("Invalid data format in the imported file.");
              }
          } catch (error) {
              console.error("Failed to import data:", error);
              alert(`Sorry, the imported file is invalid or corrupted. Please try a different file. \nError: ${error instanceof Error ? error.message : String(error)}`);
          } finally {
              event.target.value = ''; // Reset file input
          }
      };
      reader.onerror = () => {
          alert("There was an error reading the file.");
          event.target.value = ''; // Reset file input
      };
      reader.readAsText(file);
  };


  // Page Render Logic
  if (currentPage === 'welcome') {
    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-8 text-center animate-fade-in">
            <h1 className="text-5xl font-extrabold tracking-tight text-white sm:text-6xl md:text-7xl">
                {storeInfo.name}
            </h1>
            <p className="mt-4 max-w-xl mx-auto text-xl text-gray-400">
                Your personal AI-powered grocery ledger.
            </p>
            <button
                onClick={() => setCurrentPage('hub')}
                className="mt-12 bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-lg transition-colors duration-300 text-lg shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500"
            >
                Get Started
            </button>
        </div>
    );
  }

  if (isAddingCustomer) {
    return <AddCustomerForm 
        onAdd={handleAddCustomer} 
        onCancel={() => { setIsAddingCustomer(false); setAddCustomerInitialData(null); }} 
        customers={customers} 
        initialData={addCustomerInitialData || undefined}
    />;
  }
  
  if (currentPage === 'memo' && selectedCustomer && activeTransaction) {
    return (
        <MemoPage 
            customer={selectedCustomer}
            transaction={activeTransaction}
            storeInfo={storeInfo}
            onUpdateTransaction={handleUpdateTransaction}
            onBack={() => {
                setActiveTransactionId(null);
                setCurrentPage('ledger');
            }}
        />
    )
  }

  if (currentPage === 'hub') {
      return (
          <CustomerSelector 
              customers={customers}
              onSelectCustomer={handleSelectCustomer}
              onAddNewCustomer={handleAddNewCustomerRequest}
              onDeleteCustomer={handleDeleteCustomer}
              onShowAccounts={handleShowAccounts}
              isListening={isListening}
              isProcessing={isProcessing}
              onMicClick={handleMicClick}
              hubSearchTerm={hubSearchTerm}
              onSaveMemo={handleSaveMemo}
              onGoToMemo={handleGoToMemo}
              assistantMessage={assistantMessage}
              transcript={transcript}
          />
      );
  }

  if (currentPage === 'accounts') {
    return <StoreAccountsPage 
        customers={customers} 
        onBack={() => setCurrentPage('hub')}
        onExportData={handleExportData}
        onImportData={handleImportData}
    />;
  }

  if (currentPage === 'share' && selectedCustomer) {
      return (
          <SharePage
              customer={selectedCustomer}
              storeName={storeInfo.name}
              onBack={() => setCurrentPage('ledger')}
              shareContext={shareContext}
          />
      );
  }

  if (currentPage === 'ledger' && selectedCustomer) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col p-4 md:p-8">
        <header className="relative text-center mb-8">
          <button onClick={handleSwitchCustomer} className="absolute left-0 top-1/2 -translate-y-1/2 bg-gray-700 hover:bg-gray-600 text-white font-bold p-3 rounded-full transition-colors duration-300" aria-label="Switch Customer">
              <UserSwitchIcon />
          </button>
           <div className="flex items-center justify-center gap-3">
              <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
                Ledger for {selectedCustomer.name}
              </h1>
              <button onClick={() => handleToggleFavourite(selectedCustomer.id)} title={selectedCustomer.isFavourite ? "Remove from Favourites" : "Add to Favourites"}>
                <HeartIcon className={`w-8 h-8 transition-colors ${selectedCustomer.isFavourite ? 'text-pink-400 hover:text-pink-500' : 'text-gray-600 hover:text-gray-400'}`} />
              </button>
            </div>
          <p className="mt-3 text-base text-gray-400 sm:text-lg">
            Use the mic to add transactions or edit history below.
          </p>
        </header>
        
        <main className="flex-grow flex flex-col items-center gap-8">
          <BalanceCard balance={selectedCustomer.balance} />
          
          <div className="flex flex-col md:flex-row items-start justify-center gap-8 w-full max-w-4xl mx-auto">
              <div className="flex flex-col items-center gap-4 w-full max-w-sm">
                  <MicButton isListening={isListening} isProcessing={isProcessing} onClick={handleMicClick} />
                  <div className="h-12 text-center flex items-center justify-center">
                      {isProcessing && !transcript && <p className="text-blue-300">{assistantMessage}</p>}
                      {transcript && <p className="text-gray-400 italic">You said: "{transcript}"</p>}
                      {assistantMessage && !isProcessing && !transcript && <p className="text-blue-300">{assistantMessage}</p>}
                  </div>
              </div>
              <ManualInput onAdd={handleManualTransaction} />
          </div>
          
          <div className="w-full flex-grow overflow-y-auto">
              <TransactionList 
                transactions={selectedCustomer.transactions}
                onDelete={handleDeleteTransaction}
                onEditTransaction={handleEditTransaction}
              />
          </div>
        </main>

        <footer className="mt-8 text-center">
          <button
              onClick={() => setCurrentPage('share')}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition-colors duration-300 shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-green-500"
          >
              Finalize & Share Balance
          </button>
        </footer>
      </div>
    );
  }

  // Fallback if state is inconsistent
  setCurrentPage('welcome');
  return null;
};

export default App;